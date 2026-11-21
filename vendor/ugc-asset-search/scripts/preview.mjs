import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { resolveLocale } from './locale.mjs';

const previewLabels = {
  'zh-CN': {
    title: '素材试听', categories: { sound: '音效', effect: '特效', bgm: '背景音乐' },
    main: '主体效果', tail: '结束效果', music: '网易云音乐', audio: '音频直链', asset: '原始素材页',
  },
  'zh-TW': {
    title: '素材試聽', categories: { sound: '音效', effect: '特效', bgm: '背景音樂' },
    main: '主體效果', tail: '結束效果', music: '網易雲音樂', audio: '音訊連結', asset: '原始素材頁',
  },
  'en-US': {
    title: 'Asset previews', categories: { sound: 'Sound effect', effect: 'Visual effect', bgm: 'Background music' },
    main: 'Main effect', tail: 'Ending effect', music: 'NetEase Music', audio: 'Direct audio link', asset: 'Open asset page',
  },
  'ja-JP': {
    title: '素材プレビュー', categories: { sound: '効果音', effect: 'エフェクト', bgm: 'BGM' },
    main: 'メインエフェクト', tail: '終了エフェクト', music: 'NetEase Music', audio: '音声リンク', asset: '素材ページを開く',
  },
  'ru-RU': {
    title: 'Предпросмотр ресурсов', categories: { sound: 'Звуковой эффект', effect: 'Визуальный эффект', bgm: 'Фоновая музыка' },
    main: 'Основной эффект', tail: 'Завершающий эффект', music: 'NetEase Music', audio: 'Прямая ссылка на аудио', asset: 'Открыть страницу ресурса',
  },
};

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/gu, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]);
}

function renderCard(item, labels) {
  const { media } = item;
  const title = escapeHtml(item.title);
  const icon = media.icon ? `<img src="${escapeHtml(media.icon)}" alt="" loading="lazy">` : '';
  const audio = media.audio ? `
    <audio controls preload="none" src="${escapeHtml(media.audio)}" aria-label="${title}"></audio>` : '';
  const videos = [[media.video, labels.main], [media.tail, labels.tail]].filter(([url]) => url)
    .map(([url, label]) => `<figure><figcaption>${label}</figcaption>
      <video controls playsinline preload="none" src="${escapeHtml(url)}" aria-label="${title} · ${label}"></video>
    </figure>`).join('');
  const music = media.player ? `
    <iframe src="${escapeHtml(media.player)}" title="${title} · ${labels.music}" loading="lazy"
      sandbox="allow-scripts allow-same-origin" allow="encrypted-media"></iframe>` : '';
  const evidence = item.reason ? `<p>${escapeHtml(item.reason)}</p>` : '';
  const directUrl = media.audio ?? media.song;
  const directLink = directUrl ? `<a href="${escapeHtml(directUrl)}" target="_blank" rel="noreferrer">${media.song ? labels.music : labels.audio}</a>` : '';
  return `<article aria-label="${title}">
    <header>${icon}<div>
      <div class="meta">${labels.categories[item.kind]} · <code>${escapeHtml(item.resourceId)}</code></div>
      <h2>${title}</h2>
    </div></header>
    ${evidence}
    ${videos ? `<div class="videos">${videos}</div>` : ''}
    ${audio}${music}
    <footer>${directLink}<a href="${escapeHtml(item.href)}" target="_blank" rel="noreferrer">${labels.asset}</a></footer>
  </article>`;
}

function render(items, locale) {
  const labels = previewLabels[locale];
  return `<!doctype html>
<html lang="${locale}">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${labels.title}</title>
<style>
  :root { color-scheme: light dark; font: 15px/1.5 system-ui, sans-serif; --surface: #fff; --text: #191923; --muted: #5e5e70; --pane: #f4f4f8; --line: #dddde6; --link: #41428c; }
  @media (prefers-color-scheme: dark) {
    :root { --surface: #22222a; --text: #f3f3fa; --muted: #b1b1c3; --pane: #19191f; --line: #393946; --link: #c4c4ff; }
  }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--pane); color: var(--text); }
  main { width: min(100% - 32px, 860px); margin: 24px auto; }
  h1 { margin: 0 0 14px; font-size: 22px; }
  article { background: var(--surface); border: 1px solid var(--line); border-radius: 12px; padding: 16px; margin: 0 0 12px; }
  header { display: flex; align-items: center; gap: 10px; }
  header img { width: 36px; height: 36px; object-fit: contain; flex: none; }
  .meta, figcaption { color: var(--muted); font-size: 13px; }
  h2 { margin: 1px 0 0; font-size: 16px; overflow-wrap: anywhere; }
  p { margin: 10px 0; line-height: 1.6; }
  audio, video, iframe { display: block; width: 100%; max-width: 100%; border: 0; margin: 10px 0 0; }
  iframe { height: 86px; }
  video { aspect-ratio: 16/9; background: #141419; border-radius: 8px; }
  .videos { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 225px), 1fr)); gap: 12px; margin-top: 10px; }
  figure { margin: 0; }
  footer { display: flex; flex-wrap: wrap; gap: 14px; margin-top: 12px; font-size: 13px; }
  a { color: var(--link); text-underline-offset: 3px; }
</style>
<main><h1>${labels.title}</h1>${items.map(item => renderCard(item, labels)).join('')}</main>
</html>`;
}

export async function servePreview(items, locale) {
  const path = `/${randomUUID()}`;
  const html = render(items, resolveLocale(locale));
  const server = createServer((request, response) => {
    if (request.url !== path || !['GET', 'HEAD'].includes(request.method)) {
      response.writeHead(404).end();
      return;
    }
    idle.refresh();
    response.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; img-src https://oss.xiaomol444.xyz; media-src https://oss.xiaomol444.xyz; frame-src https://music.163.com; base-uri 'none'; form-action 'none'",
      'Cache-Control': 'no-store',
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
    });
    response.end(request.method === 'HEAD' ? undefined : html);
  });
  const idle = setTimeout(() => server.close(), 30 * 60_000);
  idle.unref();
  server.on('close', () => clearTimeout(idle));
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return `http://127.0.0.1:${server.address().port}${path}`;
}
