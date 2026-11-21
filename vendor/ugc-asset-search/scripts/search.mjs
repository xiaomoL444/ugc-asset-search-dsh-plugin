import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { servePreview } from './preview.mjs';
import { detectSystemLanguage, resolveLocale } from './locale.mjs';

const oss = 'https://oss.xiaomol444.xyz/ugc-tool-data';
const playerSite = 'https://tool.xiaomol444.xyz';
const checkInterval = 5 * 60_000;
const cacheSchema = 1;
const mediaSchema = 2;
const maxGuidanceBytes = 65_536;
const installedRuntime = new URL('../runtime/', import.meta.url);
const repositoryRuntime = new URL('../../../tools/ai-search-service/', import.meta.url);
const runtime = existsSync(new URL('asset-search.mjs', installedRuntime)) ? installedRuntime : repositoryRuntime;
const { createAssetCatalogLoader } = await import(new URL('asset-catalog-loader.mjs', runtime));
const { getAssetDetails, getCatalogInfo, searchAssets } = await import(new URL('asset-search.mjs', runtime));

async function readCloudJson(path, maxBytes) {
  const response = await fetch(`${oss}/${path}`, {
    cache: 'no-store',
    redirect: 'error',
    signal: AbortSignal.timeout(25_000),
  });
  if (!response.ok) throw new Error(`${path} returned HTTP ${response.status}`);
  let bytes = 0;
  const chunks = [];
  for await (const chunk of response.body) {
    bytes += chunk.byteLength;
    if (bytes > maxBytes) throw new Error(`${path} exceeds the metadata size limit`);
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8').replace(/^\uFEFF/u, ''));
}

async function releaseMarker() {
  const marker = await readCloudJson(`AISearch/index.json?_t=${Date.now()}`, 65_536);
  if (typeof marker?.data !== 'string' || !marker.data.trim() || marker.data.length > 256) {
    throw new Error('Invalid AISearch release marker');
  }
  return marker.data.trim();
}

function mediaPath(value, extensions) {
  if (typeof value !== 'string' || !value || value.length > 512 || /[\\:%?#\p{Cc}]/u.test(value)) return;
  const segments = value.split('/');
  if (segments.some(segment => !segment || segment === '.' || segment === '..' || segment.trim() !== segment)) return;
  if (!extensions.includes(value.split('.').at(-1).toLowerCase())) return;
  return segments.map(encodeURIComponent).join('/');
}

async function loadPreviewMetadata() {
  const [effects, music] = await Promise.all([
    readCloudJson('EffectPlayer/data.json', 12_000_000),
    readCloudJson('BgmPlayer/data.json', 4_000_000),
  ]);
  const effectRows = effects?.effectData;
  const songs = music?.data ?? music?.musicData;
  if (!effectRows || typeof effectRows !== 'object' || Array.isArray(effectRows) || !Array.isArray(songs)) {
    throw new Error('Invalid cloud preview metadata');
  }
  const effect = {};
  for (const [id, row] of Object.entries(effectRows)) {
    if (!/^\d{1,12}$/u.test(id) || String(row?.id) !== id) continue;
    const icon = mediaPath(row.icon, ['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg']);
    const video = mediaPath(row.standPath, ['webm', 'mp4']);
    const tail = mediaPath(row.tailPath, ['webm', 'mp4']);
    const audio = row.hasAudio === true ? mediaPath(row.audioPath, ['m4a', 'mp3', 'ogg', 'wav', 'aac']) : undefined;
    effect[id] = { icon, video, tail, audio };
  }
  const bgm = {};
  for (const song of songs) {
    if (!/^\d{1,12}$/u.test(String(song?.id))) continue;
    const songId = Number(song.song_id);
    const albumId = Number(song.album_id);
    if (Number.isSafeInteger(songId) && songId > 0) bgm[song.id] = {
      songId,
      ...(Number.isSafeInteger(albumId) && albumId > 0 ? { albumId } : {}),
    };
  }
  if (!Object.keys(effect).length || !Object.keys(bgm).length) throw new Error('Cloud preview metadata is empty');
  return { schema: mediaSchema, effect, bgm };
}

async function loadCloudCatalog() {
  const env = { ASSET_FEATURES_BASE_URL: oss };
  const options = { indexDriven: true, timeoutMs: 30_000 };
  try {
    return await createAssetCatalogLoader(options).read(env);
  } catch (error) {
    if (error.code !== 'ASSET_FEATURES_INVALID') throw error;
    // The Worker identities support older releases whose public player tables have drifted.
    // A later release can publish a new identity set verified against its feature manifests.
    const packaged = new URL('build-ai-asset-catalog.cjs', installedRuntime);
    const builder = existsSync(packaged) ? packaged : new URL('../../../scripts/build-ai-asset-catalog.cjs', import.meta.url);
    const { buildIdentityCatalog, readSnapshots } = (await import(builder)).default;
    const identities = buildIdentityCatalog(await readSnapshots(oss));
    return createAssetCatalogLoader({ ...options, identities }).read(env);
  }
}

async function readCache(file) {
  try {
    const modified = (await stat(file)).mtimeMs;
    const snapshot = JSON.parse(await readFile(file, 'utf8'));
    if (snapshot.schema === cacheSchema && snapshot.release && snapshot.catalog?.assets?.length
        && snapshot.media?.effect && snapshot.media?.bgm) return { snapshot, modified };
  } catch (error) {
    if (!(error instanceof SyntaxError) && error.code !== 'ENOENT') throw error;
  }
  return null;
}

async function saveCache(directory, file, snapshot) {
  await mkdir(directory, { recursive: true });
  const pending = join(directory, `${randomUUID()}.tmp`);
  try {
    await writeFile(pending, JSON.stringify(snapshot), { flag: 'wx' });
    await rename(pending, file);
  } finally {
    await rm(pending, { force: true });
  }
}

async function loadSnapshot(directory, { offline, force }) {
  const file = join(directory, 'catalog.json');
  const cached = await readCache(file);
  if (offline) {
    if (!cached) throw new Error('Run sync with network access before searching offline');
    return { ...cached.snapshot, status: 'offline' };
  }
  const currentMedia = cached?.snapshot.media.schema === mediaSchema;
  if (!force && currentMedia && Date.now() - cached.modified < checkInterval) {
    return { ...cached.snapshot, status: 'cached' };
  }
  try {
    const release = await releaseMarker();
    if (release === cached?.snapshot.release) {
      if (!currentMedia) {
        const media = await loadPreviewMetadata();
        if (await releaseMarker() !== release) throw new Error('The cloud catalog changed during sync. Try syncing again.');
        const next = { ...cached.snapshot, media };
        await saveCache(directory, file, next);
        return { ...next, status: 'synced' };
      }
      const checked = new Date();
      await utimes(file, checked, checked);
      return { ...cached.snapshot, status: 'current' };
    }
    const [snapshot, media] = await Promise.all([
      loadCloudCatalog(),
      loadPreviewMetadata(),
    ]);
    if (snapshot.featureSync.markerVersion !== release || await releaseMarker() !== release) {
      throw new Error('The cloud catalog changed during sync. Try syncing again.');
    }
    const next = { schema: cacheSchema, release, catalog: snapshot.catalog, media };
    await saveCache(directory, file, next);
    return { ...next, status: 'synced' };
  } catch (error) {
    if (!cached) throw new Error(`Initial cloud sync failed: ${error.message}`, { cause: error });
    return { ...cached.snapshot, status: 'stale', syncError: error.message };
  }
}

function extractSearchGuidance(source) {
  // Website-only output and tool transport are handled by the current host.
  return source.split(/^(?:#{1,6}[ \t]+.*(?:JSON|输出格式|运行协议).*$|必须使用 locale 指定语言简洁回复.*最终仅返回一个 JSON 对象)/imu, 1)[0]
    .replace(/\\([_\[\]])/gu, '$1').trim();
}

async function loadGuidance(directory, { offline, force }) {
  const file = join(directory, 'search-guidance.json');
  let cached;
  try {
    if ((await stat(file)).size <= 3 * maxGuidanceBytes) {
      const parsed = JSON.parse(await readFile(file, 'utf8'));
      if (parsed?.schema === 1 && typeof parsed.source === 'string' && Buffer.byteLength(parsed.source) <= maxGuidanceBytes
          && typeof parsed.version === 'string' && Number.isFinite(parsed.checkedAt) && extractSearchGuidance(parsed.source)) cached = parsed;
    }
  } catch {
    // Prompt cache failures leave the catalog usable.
  }
  const previous = cached ? { source: cached.source, version: cached.version } : {};
  if (offline) return { ...previous, status: cached ? 'offline' : 'unavailable' };
  if (!force && cached && Date.now() - cached.checkedAt < checkInterval) return { ...previous, status: 'cached' };
  try {
    const { createSystemPromptLoader } = await import(new URL('system-prompt.mjs', runtime));
    const source = await createSystemPromptLoader({ maxBytes: maxGuidanceBytes }).read();
    if (!extractSearchGuidance(source)) throw new Error('The site prompt has no search guidance');
    const version = createHash('sha256').update(source).digest('hex');
    await saveCache(directory, file, { schema: 1, source, version, checkedAt: Date.now() });
    return { source, version, status: version === cached?.version ? 'current' : 'synced' };
  } catch (error) {
    return { ...previous, status: cached ? 'stale' : 'unavailable', syncError: error.code ?? error.message };
  }
}

function cloudMedia(asset, media) {
  const id = asset.resourceId.split(':')[1];
  if (asset.kind === 'sound') return { audio: `${oss}/SoundEffectPlayer/audio/${id}.mp3` };
  if (asset.kind === 'effect') {
    const row = media.effect[id];
    if (!row) return {};
    const root = `${oss}/EffectPlayer`;
    return {
      icon: row.icon && `${root}/icon/${row.icon}`,
      video: row.video && `${root}/webm/${row.video}`,
      tail: row.tail && `${root}/webm/${row.tail}`,
      audio: row.audio && `${root}/audio/${row.audio}`,
    };
  }
  const record = media.bgm[id];
  const songId = typeof record === 'number' ? record : record?.songId;
  return songId ? {
    player: `https://music.163.com/outchain/player?type=2&id=${songId}&auto=0&height=66`,
    song: `https://music.163.com/song?id=${songId}`,
    ...(record?.albumId ? { cover: `${oss}/BgmPlayer/album_pic/${record.albumId}.jpg` } : {}),
  } : {};
}

function previewLinks(asset, media) {
  return { ...asset, href: new URL(asset.href, playerSite).href, media: cloudMedia(asset, media) };
}

function cardDetails(input, env, media) {
  if (!Array.isArray(input.assets) || !input.assets.length || input.assets.length > 50) {
    throw new Error('Cards require one to fifty selected assets');
  }
  const items = [], missingIds = [], seen = new Set();
  for (const entry of input.assets) {
    const { id, reason, matchType, audioMatch } = entry;
    if (seen.has(id)) continue;
    seen.add(id);
    const result = getAssetDetails({ ids: [id], locale: input.locale }, undefined, env);
    if (!result.assets.length) {
      missingIds.push(id);
      continue;
    }
    const asset = previewLinks(result.assets[0], media);
    const effectAudio = asset.kind === 'effect' && audioMatch === true;
    items.push({
      resourceId: asset.resourceId, id: asset.id, kind: asset.kind, title: asset.title,
      duration: asset.duration, isLoop: asset.isLoop, href: asset.href, media: asset.media,
      summary: effectAudio ? asset.audioShortDescription : asset.shortDescription,
      description: (effectAudio ? asset.audioDescription : asset.description).slice(0, 650),
      keywords: (effectAudio ? asset.audioKeywords : asset.keywords).slice(0, 8),
      suggestedUses: (effectAudio ? asset.audioSuggestedUses : asset.suggestedUses).slice(0, 6),
      ...(effectAudio ? { audioMatch: true } : {}),
      ...(matchType === 'suggestion' ? { matchType } : {}),
      ...(typeof reason === 'string' && reason.trim() ? { reason: reason.trim().slice(0, 300) } : {}),
    });
  }
  return { items, missingIds };
}

function output(value) {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

async function inputFrom(filename) {
  let raw;
  if (filename) raw = await readFile(filename, 'utf8');
  else {
    if (process.stdin.isTTY) throw new Error('Pipe JSON to stdin or use --input with a UTF-8 file');
    const chunks = [];
    for await (const chunk of process.stdin) chunks.push(chunk);
    raw = Buffer.concat(chunks).toString('utf8');
  }
  return JSON.parse(raw.replace(/^\uFEFF/u, ''));
}

async function main() {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: {
    input: { type: 'string' }, 'cache-dir': { type: 'string' }, offline: { type: 'boolean' },
    help: { type: 'boolean', short: 'h' },
  } });
  const [command] = positionals;
  if (values.help || !command) {
    process.stdout.write('Usage: node search.mjs locale|prepare|sync|search|details|cards|preview [--input JSON_FILE] [--offline] [--cache-dir DIRECTORY]\n');
    return;
  }
  if (!['locale', 'prepare', 'sync', 'search', 'details', 'cards', 'preview'].includes(command) || positionals.length !== 1) throw new Error('Invalid command');
  if (command === 'locale') {
    const systemLanguage = detectSystemLanguage();
    output({ systemLanguage, locale: resolveLocale(systemLanguage) });
    return;
  }
  const readsInput = command !== 'sync' && command !== 'prepare';
  const input = readsInput ? await inputFrom(values.input) : null;
  if (readsInput && (!input || typeof input !== 'object' || Array.isArray(input))) {
    throw new Error('Expected a JSON object');
  }
  const directory = values['cache-dir'] ?? join(homedir(), '.cache', 'ugc-asset-search-v1');
  const options = { offline: values.offline, force: command === 'sync' };
  const followsGuidance = !options.offline || command === 'prepare' || command === 'sync';
  const [snapshot, guidance] = await Promise.all([
    loadSnapshot(directory, options),
    followsGuidance ? loadGuidance(directory, options) : undefined,
  ]);
  const { catalog, media, release, status, syncError } = snapshot;
  const env = { ASSET_SEARCH_CATALOG: catalog, RETRIEVAL_MODE: 'keyword' };
  const { source, ...guidanceMetadata } = guidance ?? {};
  const metadata = { release, catalogVersion: catalog.indexVersion, status, ...(syncError ? { syncError } : {}),
    ...(guidance ? { guidance: guidanceMetadata } : {}) };
  if (command === 'prepare') {
    const systemLanguage = detectSystemLanguage();
    output({ ...metadata, systemLanguage, locale: resolveLocale(systemLanguage), ...(source ? { searchGuidance: extractSearchGuidance(source) } : {}) });
    return;
  }
  if (command === 'sync') {
    output({ ...metadata, counts: getCatalogInfo(env).counts });
    return;
  }
  if (command === 'search') {
    const batch = Object.hasOwn(input, 'queries');
    const queries = batch ? input.queries : [input];
    if (!Array.isArray(queries) || !queries.length || queries.length > 8) throw new Error('Pass one to eight queries');
    const results = await Promise.all(queries.map(async query => {
      if (!query || typeof query !== 'object' || Array.isArray(query)) throw new Error('Expected a query object');
      const locale = resolveLocale(query.locale ?? input.locale);
      const { candidates, ...result } = await searchAssets({ ...query, locale }, env);
      return { ...result, locale, items: candidates.map(asset => previewLinks(asset, media)) };
    }));
    output({ ...metadata, ...(batch ? { results } : results[0]) });
    return;
  }
  const locale = resolveLocale(input.locale);
  if (command === 'details') {
    const { assets, missingIds } = getAssetDetails({ ...input, locale }, undefined, env);
    output({ ...metadata, locale, items: assets.map(asset => previewLinks(asset, media)), missingIds });
    return;
  }
  if (command === 'cards') {
    output({ ...metadata, locale, ...cardDetails({ ...input, locale }, env, media) });
    return;
  }
  if (!Array.isArray(input.assets) || !input.assets.length || input.assets.length > 50) {
    throw new Error('Preview requires one to fifty selected assets');
  }
  const reasons = new Map(input.assets.map(asset => [asset.id, String(asset.reason ?? '').slice(0, 300)]));
  const ids = [...reasons.keys()];
  const assets = [], missingIds = [];
  // The shared catalog accepts up to ten IDs per details lookup.
  for (let start = 0; start < ids.length; start += 10) {
    const batch = getAssetDetails({ ids: ids.slice(start, start + 10), locale }, undefined, env);
    assets.push(...batch.assets);
    missingIds.push(...batch.missingIds);
  }
  if (!assets.length) throw new Error('No selected resource IDs exist in the local catalog');
  const items = assets.map(asset => ({ ...previewLinks(asset, media), reason: reasons.get(asset.resourceId) }));
  const url = await servePreview(items, locale);
  output({ ...metadata, locale, url, missingIds });
}

try {
  await main();
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
}
