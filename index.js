/**
 * Miliastra Wonderland (千星奇域) asset catalog for DeepSeek Harness.
 *
 * One search core serves two callers, as the Harness practice requires: the
 * agent tool `miliastra_assets` and the browser panel's same-origin JSON route
 * under `/miliastra-assets/api/`. Both read the catalog cache that the Codex skill
 * `ugc-asset-search` already keeps on this machine
 * (`%USERPROFILE%\.cache\ugc-asset-search-v1\catalog.json`), so the plugin adds
 * no second copy of the 50 MB index and no network traffic of its own.
 *
 * The vendored runtime is the skill's own `runtime/`, unchanged: this package
 * only loads the JSON cache once, builds the search environment, and maps asset
 * records onto preview media URLs.
 */

import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync, statSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { SYSTEM_PROMPT_URL } from './vendor/ugc-asset-search/runtime/system-prompt.mjs'

const RUNTIME_URL = new URL('./vendor/ugc-asset-search/runtime/asset-search.mjs', import.meta.url)
const SYNC_SCRIPT = new URL('./vendor/ugc-asset-search/scripts/search.mjs', import.meta.url)
const OSS_ORIGIN = 'https://oss.xiaomol444.xyz/ugc-tool-data'
const PLAYER_ORIGIN = 'https://tool.xiaomol444.xyz'
const CACHE_SCHEMA = 1
const ROUTE_PREFIX = '/miliastra-assets/api'
const LOCALES = ['zh-CN', 'zh-TW', 'en-US', 'ja-JP', 'ru-RU']
const SCOPES = ['all', 'sound', 'effect', 'bgm']
const MATCH_ON = ['any', 'audio', 'visual']
const SEARCH_TYPES = ['feature', 'suggestion', 'both']
const RESOURCE_ID = /^(?:sound|effect|bgm):[0-9]{1,12}$/u
const DEFAULT_LIMIT = 15
const MAX_LIMIT = 50
const CACHE_DIR = process.env.MILIASTRA_ASSET_CACHE || join(homedir(), '.cache', 'ugc-asset-search-v1')
/** Cloud release marker: `{ data: "<release>" }`, the same one the sync command reads. */
const RELEASE_MARKER_URL = `${OSS_ORIGIN}/AISearch/index.json`
/** Cached site prompt written by the sync command, and the prompt section it feeds. */
const GUIDANCE_FILE = join(CACHE_DIR, 'search-guidance.json')
const GUIDANCE_SECTION = 'miliastra-assets:search-guidance'
const GUIDANCE_ORDER = 5000
/** The site prompt is a per-request cost; `MILIASTRA_ASSET_GUIDANCE=off` drops it. */
const GUIDANCE_ENABLED = process.env.MILIASTRA_ASSET_GUIDANCE !== 'off'
/** Minimum gap between release checks; `off` disables them. */
const CHECK_INTERVAL = (() => {
  const raw = process.env.MILIASTRA_ASSET_CHECK_INTERVAL
  if (raw === 'off' || raw === 'false') return 0
  const parsed = Number.parseInt(String(raw ?? ''), 10)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 5 * 60_000
})()

/** @type {{ at: number, latest: string | undefined }} */
let releaseCheck = { at: 0, latest: undefined }
/**
 * Downloads are opt-in: by default a newer release is reported so the model can
 * ask first. `MILIASTRA_ASSET_AUTO_SYNC=on` downloads it in the background.
 */
const AUTO_SYNC = process.env.MILIASTRA_ASSET_AUTO_SYNC === 'on'
/** Wait before retrying a release whose download failed. */
const SYNC_RETRY_MS = 10 * 60_000
/** Download state: in flight, the release that just landed, and the last failure. */
let syncing = false
/** @type {{ from: string, to: string } | undefined} */
let syncApplied
/** @type {{ release: string, message: string } | undefined} */
let syncFailure
let syncRetryAt = 0
/** Release already reported to the user, so one release is asked about once. */
let askedRelease
/** Site-prompt version already reported, so one prompt update is asked about once. */
let askedGuidance

/** @type {{ snapshot: any, api: any, env: any, readAt: number } | undefined} */
let loaded
/** @type {Promise<any> | undefined} */
let loading

export const name = 'miliastra-assets'
export const inject = ['tools']

function cacheFile() {
  return join(CACHE_DIR, 'catalog.json')
}

/**
 * Ask the cloud whether the catalog moved on, at most once per interval.
 * Reads only the small release marker, never the catalog itself; a network
 * failure is silent because freshness is a hint, not a search condition.
 * @param current - the release the loaded snapshot carries.
 * @returns the newer release, or undefined when the local one is current.
 */
export function checkRelease(current) {
  if (CHECK_INTERVAL === 0) return Promise.resolve(undefined)
  if (Date.now() - releaseCheck.at < CHECK_INTERVAL) {
    return Promise.resolve(
      releaseCheck.latest === undefined || releaseCheck.latest === current ? undefined : releaseCheck.latest,
    )
  }
  releaseCheck = { at: Date.now(), latest: undefined }
  return (async () => {
    try {
      const response = await fetch(`${RELEASE_MARKER_URL}?_t=${Date.now()}`, {
        cache: 'no-store',
        redirect: 'error',
        signal: AbortSignal.timeout(2_500),
      })
      if (!response.ok) return undefined
      const marker = await response.json()
      const latest = marker && typeof marker.data === 'string' ? marker.data.trim() : ''
      if (!latest || latest.length > 256) return undefined
      releaseCheck = { at: Date.now(), latest }
      return latest === current ? undefined : latest
    } catch {
      return undefined
    }
  })()
}

/**
 * The site prompt the sync command caches beside the catalog. Read on change,
 * not on every assembly: a section callback runs per step, so the file is only
 * re-parsed when its modification time moves.
 */
let guidance = { mtimeMs: -1, version: '', text: '' }

/**
 * Re-read the cached site prompt when the file changed.
 * @returns the current guidance view, whose `text` is the section body.
 */
export function refreshGuidance() {
  try {
    const stat = statSync(GUIDANCE_FILE)
    if (stat.mtimeMs === guidance.mtimeMs) return guidance
    const parsed = JSON.parse(readFileSync(GUIDANCE_FILE, 'utf8'))
    const source = parsed && typeof parsed.source === 'string' ? parsed.source.trim() : ''
    const version = parsed && typeof parsed.version === 'string' ? parsed.version : ''
    guidance = { mtimeMs: stat.mtimeMs, version, text: renderGuidance(source, version) }
    return guidance
  } catch {
    if (guidance.mtimeMs !== -1) guidance = { mtimeMs: -1, version: '', text: '' }
    return guidance
  }
}

/**
 * Turn the site prompt into the section body: its own RESULT_LIMIT token is
 * bound to this plugin's default, and the site's answer protocol is cut away —
 * that protocol describes the web app's JSON replies, not a chat turn.
 * @param source - the cached Markdown prompt.
 * @param version - content hash the cache recorded.
 */
function renderGuidance(source, version) {
  if (!source) return ''
  // The rules up to the answer protocol are about searching; everything from
  // the protocol onward mandates a JSON reply this conversation does not use.
  const protocolStart = source.indexOf('必须使用 locale 指定语言简洁回复')
  const rules = (protocolStart > 0 ? source.slice(0, protocolStart) : source).trim()
  const body = rules.replace(/\bRESULT_LIMIT\b/gu, String(DEFAULT_LIMIT))
  const tag = version ? `（站点提示词版本 ${version.slice(0, 12)}）` : ''
  const note = '【本对话的适用方式】以上是站点检索规则。当前是聊天对话而不是站点接口：'
    + '不要输出 JSON、answer/matches 字段或代码围栏，检索后直接用自然语言简短回答，并照常给出素材编号。'
  return `## 千星奇域素材检索规则${tag}\n\n${body}\n\n${note}`
}

/** @type {{ at: number, latest: string | undefined }} */
let guidanceCheck = { at: 0, latest: undefined }

/**
 * Compare the cached site prompt with the published one, at most once per
 * interval, so an update can be offered without touching the catalog.
 * @param current - version hash the cached prompt carries.
 * @returns the published version when it differs, otherwise undefined.
 */
export function checkGuidance(current) {
  if (CHECK_INTERVAL === 0) return Promise.resolve(undefined)
  if (Date.now() - guidanceCheck.at < CHECK_INTERVAL) {
    return Promise.resolve(
      guidanceCheck.latest === undefined || guidanceCheck.latest === current ? undefined : guidanceCheck.latest,
    )
  }
  guidanceCheck = { at: Date.now(), latest: undefined }
  return (async () => {
    try {
      const response = await fetch(`${SYSTEM_PROMPT_URL}?_t=${Date.now()}`, {
        cache: 'no-store',
        redirect: 'error',
        headers: { accept: 'text/markdown, text/plain' },
        signal: AbortSignal.timeout(2_500),
      })
      if (!response.ok) return undefined
      const source = (await response.text()).trim()
      if (!source) return undefined
      const version = createHash('sha256').update(source).digest('hex')
      guidanceCheck = { at: Date.now(), latest: version }
      return version === current ? undefined : version
    } catch {
      return undefined
    }
  })()
}

/**
 * Download a newer catalog in the background, keeping the snapshot already
 * loaded for the search that noticed it. Success is reported once by the next
 * search; a failure waits before the next attempt instead of retrying on every
 * search.
 * @param latest - release the cloud marker named.
 * @param current - release the running search used.
 */
export function startBackgroundSync(latest, current) {
  if (!AUTO_SYNC || syncing || Date.now() < syncRetryAt) return
  syncing = true
  void (async () => {
    try {
      const result = await syncCatalog()
      syncApplied = { from: current, to: typeof result?.release === 'string' ? result.release : latest }
      syncFailure = undefined
      syncRetryAt = 0
    } catch (error) {
      syncFailure = { release: latest, message: String((error && error.message) || error).slice(0, 200) }
      syncRetryAt = Date.now() + SYNC_RETRY_MS
    } finally {
      syncing = false
    }
  })()
}

/**
 * Read the on-disk catalog snapshot once and keep the parsed form for the
 * lifetime of this plugin. The cache is written by the skill's `sync` command;
 * a missing file is a user-visible condition, not a crash.
 */
async function catalog() {
  if (loaded) return loaded
  if (!loading) {
    loading = (async () => {
      let snapshot
      try {
        snapshot = JSON.parse(await readFile(cacheFile(), 'utf8'))
      } catch (error) {
        if (error?.code === 'ENOENT') {
          const missing = new Error('本机还没有素材目录缓存。')
          missing.code = 'ENOENT_CACHE'
          throw missing
        }
        throw new Error(`读取素材目录缓存失败：${error?.message ?? error}`)
      }
      if (snapshot?.schema !== CACHE_SCHEMA || typeof snapshot.release !== 'string'
        || !Array.isArray(snapshot.catalog?.assets) || !snapshot.catalog.assets.length) {
        throw new Error('素材目录缓存格式不兼容，请重新同步。')
      }
      const api = await import(RUNTIME_URL.href)
      const env = { ASSET_SEARCH_CATALOG: snapshot.catalog, RETRIEVAL_MODE: 'keyword' }
      loaded = { snapshot, api, env, readAt: Date.now() }
      return loaded
    })().finally(() => { loading = undefined })
  }
  return loading
}

/**
 * Load the catalog, or report that this machine has never synced one.
 * @returns the loaded state, or undefined when the cache file is absent.
 */
async function loadCatalog() {
  try {
    return await catalog()
  } catch (error) {
    if (error?.code === 'ENOENT_CACHE') return undefined
    throw error
  }
}

function pick(value, allowed, fallback) {
  return typeof value === 'string' && allowed.includes(value) ? value : fallback
}

function toInt(value) {
  const number = typeof value === 'number' ? value : Number.parseInt(String(value ?? ''), 10)
  return Number.isFinite(number) ? number : undefined
}

/**
 * Resolve one asset's preview links exactly as the skill's `cards` command
 * does, so the panel and the terminal skill agree on every URL.
 */
function previewOf(asset, media) {
  const id = String(asset.resourceId).split(':')[1]
  const output = { ...asset, href: new URL(asset.href, PLAYER_ORIGIN).href, media: {} }
  if (asset.kind === 'sound') {
    output.media = { audio: `${OSS_ORIGIN}/SoundEffectPlayer/audio/${id}.mp3` }
  } else if (asset.kind === 'effect') {
    const row = media?.effect?.[id]
    if (row) {
      output.media = {
        ...(row.icon ? { icon: `${OSS_ORIGIN}/EffectPlayer/icon/${row.icon}` } : {}),
        ...(row.video ? { video: `${OSS_ORIGIN}/EffectPlayer/webm/${row.video}` } : {}),
        ...(row.tail ? { tail: `${OSS_ORIGIN}/EffectPlayer/webm/${row.tail}` } : {}),
        ...(row.audio ? { audio: `${OSS_ORIGIN}/EffectPlayer/audio/${row.audio}` } : {}),
      }
    }
  } else {
    const record = media?.bgm?.[id]
    const songId = typeof record === 'number' ? record : record?.songId
    if (songId) {
      output.media = {
        player: `https://music.163.com/outchain/player?type=2&id=${songId}&auto=0&height=66`,
        song: `https://music.163.com/song?id=${songId}`,
        ...(record?.albumId ? { cover: `${OSS_ORIGIN}/BgmPlayer/album_pic/${record.albumId}.jpg` } : {}),
      }
    }
  }
  return output
}

/**
 * Search the local catalog.
 * @param raw - request fields from an agent tool call or a panel query string.
 * @returns catalog release, coverage and ordered asset previews.
 */
export async function searchAssets(raw = {}) {
  const query = typeof raw.query === 'string' ? raw.query.trim() : ''
  if (!query) throw new Error('请先给出要检索的关键词或素材编号。')
  if (query.length > 2000) throw new Error('检索词过长。')
  const locale = pick(raw.locale, LOCALES, 'zh-CN')
  const limit = Math.min(Math.max(toInt(raw.limit) ?? DEFAULT_LIMIT, 1), MAX_LIMIT)
  const state = await loadCatalog()
  if (state === undefined) {
    // A machine that never synced has no catalog to search: report that instead
    // of failing, so the model can ask the user before a ~54 MB download.
    return { release: null, locale, total: 0, items: [], needsSync: true }
  }
  const { snapshot, api, env } = state
  // Freshness runs beside the search: the marker read is throttled, and the
  // search itself does not wait for anything but that short check.
  const pending = checkRelease(snapshot.release)
  const pendingGuidance = checkGuidance(refreshGuidance().version)
  const result = await api.searchAssets({
    query,
    scope: pick(raw.scope, SCOPES, 'all'),
    matchOn: pick(raw.matchOn, MATCH_ON, 'any'),
    searchType: pick(raw.searchType, SEARCH_TYPES, 'both'),
    locale,
    limit,
    ...(typeof raw.cursor === 'string' && raw.cursor ? { cursor: raw.cursor } : {}),
  }, env)
  const newer = await pending
  const newerGuidance = await pendingGuidance
  if (newer !== undefined && AUTO_SYNC) startBackgroundSync(newer, snapshot.release)
  // One question per release: a release already reported is not repeated on
  // every following search.
  let ask = false
  if (newer !== undefined && !AUTO_SYNC && newer !== askedRelease) {
    askedRelease = newer
    ask = true
  }
  const applied = syncApplied
  syncApplied = undefined
  const failure = syncFailure
  syncFailure = undefined
  let askGuidance = false
  if (newerGuidance !== undefined && newerGuidance !== askedGuidance) {
    askedGuidance = newerGuidance
    askGuidance = true
  }
  return {
    release: snapshot.release,
    catalogVersion: snapshot.catalog.indexVersion,
    locale,
    effectiveScope: result.effectiveScope,
    matchOn: result.matchOn,
    mode: result.mode,
    total: result.total,
    nextCursor: result.nextCursor ?? null,
    items: (result.candidates ?? []).map(asset => previewOf(asset, snapshot.media)),
    ...(result.retrievalNotice ? { notice: result.retrievalNotice } : {}),
    ...(ask ? { updateAvailable: { current: snapshot.release, latest: newer } } : {}),
    ...(askGuidance ? { guidanceUpdate: { version: newerGuidance } } : {}),
    ...(applied ? { catalogUpdated: applied } : {}),
    ...(failure ? { syncFailed: failure } : {}),
  }
}

/**
 * Read the full record of a few already-found assets.
 * @param raw - `ids` plus an optional `locale`.
 */
export async function readAssets(raw = {}) {
  const ids = Array.isArray(raw.ids)
    ? [...new Set(raw.ids.filter(id => typeof id === 'string' && RESOURCE_ID.test(id)))]
    : []
  if (!ids.length) throw new Error('请给出 sound:/effect:/bgm: 形式的素材编号。')
  const locale = pick(raw.locale, LOCALES, 'zh-CN')
  const state = await loadCatalog()
  if (state === undefined) return { release: null, locale, items: [], missingIds: ids, needsSync: true }
  const { snapshot, api, env } = state
  const { assets, missingIds } = api.getAssetDetails({ ids: ids.slice(0, MAX_LIMIT), locale }, undefined, env)
  return {
    release: snapshot.release,
    locale,
    items: assets.map(asset => previewOf(asset, snapshot.media)),
    missingIds,
  }
}

/** Report what the loaded cache covers. */
export async function catalogStatus() {
  const state = await loadCatalog()
  if (state === undefined) {
    return { release: null, counts: null, cacheDir: CACHE_DIR, readAt: null, needsSync: true }
  }
  const { snapshot, api, env, readAt } = state
  return {
    release: snapshot.release,
    catalogVersion: snapshot.catalog.indexVersion,
    counts: api.getCatalogInfo(env).counts,
    cacheDir: CACHE_DIR,
    readAt: new Date(readAt).toISOString(),
  }
}

/**
 * Refresh the cache once through the skill's own `sync` command, then drop the
 * parsed snapshot so the next read sees the new release. The child runs the
 * very same script the terminal skill documents, so cache layout stays shared.
 */
export async function syncCatalog() {
  const output = await new Promise((resolve, reject) => {
    execFile(process.execPath, [fileURLToPath(SYNC_SCRIPT), 'sync', '--cache-dir', CACHE_DIR], {
      cwd: undefined,
      encoding: 'utf8',
      timeout: 180_000,
      maxBuffer: 8_000_000,
      windowsHide: true,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(String(stderr || error.message).trim().slice(0, 400) || '同步失败'))
        return
      }
      resolve(stdout)
    })
  })
  loaded = undefined
  try {
    const parsed = JSON.parse(output)
    return { synced: true, release: parsed.release, counts: parsed.counts }
  } catch {
    return { synced: true }
  }
}

/** Collapse whitespace and cut one display string to a bounded length. */
function clip(value, max) {
  if (typeof value !== 'string') return ''
  const text = value.replace(/\s+/gu, ' ').trim()
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}

/**
 * Map one catalog record onto the card fields the card document reads. The names
 * follow the Codex bundle's own card app (`resourceId`, `description`,
 * `hasAudio`), so the same records drive both this Host and that HTML UI.
 * @param asset - one record from search or details.
 * @returns the compact card payload, or undefined for an unusable record.
 */
function cardItem(asset) {
  if (!asset || typeof asset.resourceId !== 'string') return undefined
  const media = asset.media && typeof asset.media === 'object' ? asset.media : {}
  // The card app keys its own media resolution, the visible "编号" line and the
  // copy-id button on the bare numeric `id`, while the model and the tool speak
  // `resourceId`. Both must travel.
  const numeric = typeof asset.id === 'string'
    ? asset.id
    : String(asset.resourceId).slice(String(asset.resourceId).indexOf(':') + 1)
  const item = {
    resourceId: asset.resourceId,
    id: numeric,
    kind: SCOPES.includes(asset.kind) && asset.kind !== 'all' ? asset.kind : 'sound',
    title: clip(asset.title, 120) || asset.resourceId,
  }
  const description = clip(asset.summary || asset.description, 240)
  if (description) item.description = description
  const keywords = Array.isArray(asset.keywords)
    ? asset.keywords.filter(word => typeof word === 'string' && word.trim()).slice(0, 10)
    : []
  if (keywords.length) item.keywords = keywords
  if (typeof asset.duration === 'number' && Number.isFinite(asset.duration) && asset.duration > 0) {
    item.duration = asset.duration
  }
  if (asset.matchType === 'suggestion') item.matchType = 'suggestion'
  if (asset.audioMatch === true) item.audioMatch = true
  if (typeof asset.href === 'string') item.href = asset.href
  const preview = {}
  for (const key of ['audio', 'icon', 'video', 'cover', 'song', 'player']) {
    if (typeof media[key] === 'string') preview[key] = media[key]
  }
  if (Object.keys(preview).length) item.media = preview
  item.hasAudio = typeof preview.audio === 'string'
  return item
}

/**
 * Presentation projection for the conversation card view: the same records the
 * model reads, carrying only what a card draws. Persisted with the tool result,
 * so a reopened Session replays the cards without another catalog read.
 * @param value - the tool's canonical result value.
 * @param action - the call's `action` argument.
 */
export function cardMeta(value, action) {
  if (!value || typeof value !== 'object') return undefined
  const items = (Array.isArray(value.items) ? value.items : []).map(cardItem).filter(Boolean)
  if (!items.length) return undefined
  return {
    action,
    ...(typeof value.release === 'string' ? { release: value.release } : {}),
    ...(typeof value.locale === 'string' ? { locale: value.locale } : {}),
    total: typeof value.total === 'number' ? value.total : items.length,
    ...(typeof value.nextCursor === 'string' && value.nextCursor ? { nextCursor: value.nextCursor } : {}),
    ...(Array.isArray(value.missingIds) && value.missingIds.length ? { missingIds: value.missingIds } : {}),
    items,
  }
}

/**
 * Model-facing rendering: one line per asset, so a fifteen-hit search costs a
 * few hundred tokens instead of a JSON dump of every preview URL. The card
 * view reads its own data from the presentation projection.
 * @param value - the tool's canonical result value.
 */
export function renderText(value) {
  if (!value || typeof value !== 'object') return String(value ?? '')
  if (value.needsSync === true) {
    return 'catalog=本机还没有素材目录（首次使用要先下载，约 54 MB）；先问用户要不要现在下载，同意后调用 sync，再重新检索。'
  }
  const lines = []
  const head = []
  if (value.counts && typeof value.counts === 'object') {
    head.push(`catalog=${JSON.stringify(value.counts)}`)
    if (typeof value.release === 'string') head.push(`release=${value.release}`)
    if (typeof value.cacheDir === 'string') head.push(`cache=${value.cacheDir}`)
  } else {
    if (typeof value.release === 'string') head.push(`release=${value.release}`)
    if (typeof value.total === 'number') head.push(`hits=${value.total}`)
    if (typeof value.locale === 'string') head.push(`locale=${value.locale}`)
  }
  if (head.length) lines.push(head.join(' '))
  for (const item of Array.isArray(value.items) ? value.items : []) {
    const fields = [item.resourceId, clip(item.title, 80)]
    const summary = clip(item.summary || item.description, 80)
    if (summary) fields.push(summary)
    if (typeof item.duration === 'number' && item.duration > 0) fields.push(`${item.duration}s`)
    if (item.audioMatch === true) fields.push('audio-match')
    if (item.matchType === 'suggestion') fields.push('use-suggestion')
    lines.push(fields.filter(Boolean).join(' · '))
  }
  if (Array.isArray(value.missingIds) && value.missingIds.length) {
    lines.push(`missing=${value.missingIds.join(',')}`)
  }
  if (typeof value.nextCursor === 'string' && value.nextCursor) lines.push(`nextCursor=${value.nextCursor}`)
  if (typeof value.notice === 'string' && value.notice) lines.push(`notice=${value.notice}`)
  if (value.updateAvailable && typeof value.updateAvailable.latest === 'string') {
    lines.push(`update=远端目录已有新版 ${value.updateAvailable.latest}（本机 ${value.updateAvailable.current}），告诉用户，经其同意后再调用 sync 下载`)
  }
  if (value.guidanceUpdate && typeof value.guidanceUpdate.version === 'string') {
    lines.push('guidance=站点检索提示词有更新，告诉用户并等其同意后再调用 sync 刷新（不影响本次结果）')
  }
  if (value.catalogUpdated && typeof value.catalogUpdated.to === 'string') {
    lines.push(`catalog=已自动更新到 ${value.catalogUpdated.to}（原 ${value.catalogUpdated.from}），本次检索已用新目录，顺带告诉用户即可`)
  }
  if (value.syncFailed && typeof value.syncFailed.release === 'string') {
    lines.push(`syncFailed=自动更新到 ${value.syncFailed.release} 失败：${value.syncFailed.message || '未知原因'}，可改用 sync 手动重试`)
  }
  return lines.length ? lines.join('\n') : '{}'
}

function send(res, status, value) {
  const body = JSON.stringify(value)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(body),
  })
  res.end(body)
}

/** Route one panel request to the same functions the agent tool calls. */
async function dispatch(resource, params) {
  if (resource === 'status') return catalogStatus()
  if (resource === 'search') {
    return searchAssets({
      query: params.get('query') ?? '',
      scope: params.get('scope') ?? undefined,
      matchOn: params.get('matchOn') ?? undefined,
      searchType: params.get('searchType') ?? undefined,
      locale: params.get('locale') ?? undefined,
      limit: params.get('limit') ?? undefined,
      cursor: params.get('cursor') ?? undefined,
    })
  }
  if (resource === 'detail') {
    const ids = params.getAll('id').flatMap(value => value.split(','))
    return readAssets({ ids, locale: params.get('locale') ?? undefined })
  }
  if (resource === 'sync') return syncCatalog()
  return undefined
}

const CARD_FILES = ['vendor/ugc-card/results.html', 'vendor/ugc-card/results.css', 'vendor/ugc-card/results.js']
/** @type {string | undefined} */
let cardCache

/**
 * Compose the Codex bundle's own result card document: its template with the
 * stylesheet and script inlined, exactly the way that bundle's MCP server does
 * it. Read once; the document is static and receives its data from the frame
 * parent after load.
 * @returns the complete HTML document served to the conversation frame.
 */
export async function cardDocument() {
  if (cardCache !== undefined) return cardCache
  const [template, styles, script] = await Promise.all(
    CARD_FILES.map(file => readFile(new URL(`./${file}`, import.meta.url), 'utf8')),
  )
  cardCache = template
    .replace('/* RESULTS_STYLE */', () => styles)
    .replace('/* RESULTS_SCRIPT */', () => script.replace(/<\/script/giu, '<\\/script'))
  return cardCache
}

/**
 * Answer the panel's same-origin JSON requests over a top-level route, the
 * placement the shipped plugin fetch routes use. The route is not inside `/api`
 * — that prefix belongs to the connection's RPC carrier — so it applies the
 * connection's own trust and browser-authentication check itself.
 * @param connection - the Host connection service that owns the trust fence.
 */
function createHandler(connection) {
  return async (req, res) => {
    const rejection = connection.requestRejection(req)
    if (rejection !== undefined) {
      res.writeHead(rejection)
      res.end()
      return
    }
    if (req.method !== 'GET') {
      res.writeHead(405, { allow: 'GET' })
      res.end()
      return
    }
    let url
    try {
      url = new URL(String(req.url ?? ''), 'http://localhost')
    } catch {
      send(res, 400, { error: 'bad request' })
      return
    }
    // A prefix route is registered without a trailing slash, so the sub-path
    // keeps its own leading one.
    const resource = url.pathname.slice(ROUTE_PREFIX.length).replace(/^\/+|\/+$/gu, '')
    if (resource === 'card') {
      try {
        const html = await cardDocument()
        res.writeHead(200, {
          'content-type': 'text/html; charset=utf-8',
          'cache-control': 'no-store',
          'content-length': Buffer.byteLength(html),
        })
        res.end(html)
      } catch (error) {
        res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' })
        res.end(String(error?.message ?? error))
      }
      return
    }
    try {
      const value = await dispatch(resource, url.searchParams)
      if (value === undefined) {
        send(res, 404, { error: 'not found' })
        return
      }
      send(res, 200, value)
    } catch (error) {
      send(res, 502, { error: String(error?.message ?? error) })
    }
  }
}

/**
 * Register the agent tool and the panel route.
 * @param ctx - the plugin's Cordis context.
 */
export function apply(ctx) {
  // The site prompt the sync command caches is the search rulebook; it enters
  // the system prompt as its own section, re-read when the cached file changes.
  ctx.inject(['systemPrompt'], inner => inner.effect(() => inner.systemPrompt.section({
    name: GUIDANCE_SECTION,
    order: GUIDANCE_ORDER,
    interpolate: false,
    text: () => (GUIDANCE_ENABLED ? refreshGuidance().text : ''),
  }), 'miliastra-assets: search guidance'))

  ctx.effect(() => ctx.tools.register({
    name: 'miliastra_assets',
    description: 'Search the local 千星奇域 (Miliastra Wonderland) asset catalog for sound effects, visual effects and '
      + 'background music, then read full records with preview media URLs. Use action "search" with a short acoustic or '
      + 'visual description, then action "details" for the ids worth showing. Return 15 results unless the user asked '
      + 'for a specific count. Pass locale for metadata language. '
      + 'Search and details results also render as asset cards in the conversation, so describe the picks and why they '
      + 'fit in one or two sentences instead of repeating each field. A machine that never synced reports needsSync: ask '
      + 'before running sync (about 54 MB). A search also checks the cloud release marker and the site prompt: report a '
      + 'newer catalog or prompt, and run sync only after the user agrees.',
    parameters: {
      type: 'object',
      required: ['action'],
      additionalProperties: false,
      properties: {
        action: { type: 'string', enum: ['search', 'details', 'status', 'sync'], description: 'Operation to run.' },
        query: { type: 'string', description: 'search: keywords, or an exact `sound:50419` style id.' },
        scope: { type: 'string', enum: SCOPES, description: 'search: asset kind. Defaults to all.' },
        matchOn: { type: 'string', enum: MATCH_ON, description: 'search: which evidence to match. Defaults to any.' },
        searchType: { type: 'string', enum: SEARCH_TYPES, description: 'search: feature keywords or suggested uses. Defaults to both.' },
        limit: { type: 'integer', minimum: 1, maximum: MAX_LIMIT, description: 'search: results to return. Keep the default 15 unless the user asked for a specific count.' },
        cursor: { type: 'string', description: 'search: nextCursor from a previous call.' },
        ids: {
          type: 'array',
          maxItems: MAX_LIMIT,
          items: { type: 'string' },
          description: 'details: resource ids such as sound:50419.',
        },
        locale: { type: 'string', enum: LOCALES, description: 'Metadata language. Defaults to zh-CN.' },
      },
    },
    output: {
      schema: { type: 'object', description: 'Catalog status, or asset records with preview media URLs.' },
      render(_args, value) {
        return [{ type: 'text', text: renderText(value) }]
      },
      presentationMeta(args, value) {
        const action = args && typeof args === 'object' ? args.action : undefined
        // The projection must be lossless JSON on every call, so a call with no
        // cards publishes null rather than undefined.
        if (action !== 'search' && action !== 'details') return null
        return cardMeta(value, action) ?? null
      },
    },
    async execute(args) {
      const input = args && typeof args === 'object' ? args : {}
      switch (input.action) {
        case 'search': return searchAssets(input)
        case 'details': return readAssets(input)
        case 'status': return catalogStatus()
        case 'sync': return syncCatalog()
        default: throw new Error('action 必须是 search、details、status 或 sync。')
      }
    },
  }), 'miliastra-assets: agent tool')

  ctx.inject(['webServer', 'connection'], webCtx => {
    webCtx.effect(() => webCtx.webServer.register({
      kind: 'prefix',
      path: ROUTE_PREFIX,
      handler: createHandler(webCtx.connection),
    }), 'miliastra-assets: panel api route')
  })
}
