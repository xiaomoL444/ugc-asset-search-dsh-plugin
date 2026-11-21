/**
 * Browser half of the Miliastra Wonderland asset panel.
 *
 * One registration pair makes the left-sidebar entry: a `sidebar.panellist`
 * glyph whose id is the panel id, and the `main` panel registered under that
 * same id, so the shell's own panel row selects this page and nothing here has
 * to drive navigation. Search and records come from this package's Host half
 * over the same-origin `/miliastra-assets/api/` route; media streams straight from the
 * catalog's public origin.
 *
 * Written as plain JavaScript for the client module table: no JSX, no imports,
 * React from `require('react')`.
 */

window.__ModuleLoader__.load({
  id: 'miliastra-ugc-asset-search',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useCallback, useEffect, useMemo, useRef, useState } = React

    const NS = 'miliastra-assets'
    const API = '/miliastra-assets/api/'
    const SCOPES = ['all', 'sound', 'effect', 'bgm']

    const ZH = {
      panel: '千星奇域素材',
      title: '千星奇域素材',
      subtitle: '检索本机同步的音效、特效与背景音乐目录，选中即可试听。',
      search: '搜索',
      searching: '检索中…',
      placeholder: '描述你想要的听感或画面，例如“短促金属机关”“UI 确认音”',
      scopeAll: '全部',
      scopeSound: '音效',
      scopeEffect: '特效',
      scopeBgm: '音乐',
      empty: '还没有结果。输入描述开始检索。',
      emptyHint: '首次使用需要先同步一次目录，之后检索都在本机完成。',
      noResult: '按这些关键词暂未找到候选，可以换个说法再试。',
      total: '命中 {n} 条',
      more: '继续加载',
      loading: '加载中…',
      sync: '同步目录',
      syncing: '同步中…',
      synced: '目录已更新',
      retry: '重试',
      play: '试听',
      pause: '暂停',
      detail: '详情',
      collapse: '收起',
      open: '打开源站',
      music: '网易云',
      keys: '关键词',
      uses: '用途建议',
      audioMatch: '音轨命中',
      suggestion: '用途建议',
      version: '目录 {release}',
      count: '{total} 条素材',
      failed: '读取失败',
      kindAll: '合集',
      kindSound: '音效',
      kindEffect: '特效',
      kindBgm: '音乐',
      cardsTitle: '素材卡片',
      cardsPreparing: '正在检索素材…',
      cardsSearching: '正在检索「{query}」…',
      cardsFailed: '素材检索失败',
      cardsStatus: '目录状态',
      cardsSynced: '目录已同步',
      cardsEmpty: '没有可展示的素材',
      hits: '命中 {n} 条',
      cardsMore: '还有更多结果，可在素材面板里继续翻页',
    }

    const EN = {
      panel: 'Miliastra assets',
      title: 'Miliastra assets',
      subtitle: 'Search the Wonderland sound, effect and music catalog synced on this machine, then preview any hit.',
      search: 'Search',
      searching: 'Searching…',
      placeholder: 'Describe the sound or look you want, such as "short metallic click"',
      scopeAll: 'All',
      scopeSound: 'Sound',
      scopeEffect: 'Effect',
      scopeBgm: 'Music',
      empty: 'No results yet. Describe what you need to start.',
      emptyHint: 'Sync the catalog once; every later search runs locally.',
      noResult: 'No candidate matched these words. Try a different phrasing.',
      total: '{n} hits',
      more: 'Load more',
      loading: 'Loading…',
      sync: 'Sync catalog',
      syncing: 'Syncing…',
      synced: 'Catalog updated',
      retry: 'Retry',
      play: 'Play',
      pause: 'Pause',
      detail: 'Details',
      collapse: 'Collapse',
      open: 'Open source site',
      music: 'NetEase Music',
      keys: 'Keywords',
      uses: 'Suggested uses',
      audioMatch: 'Audio matched',
      suggestion: 'Use suggestion',
      version: 'Catalog {release}',
      count: '{total} assets',
      failed: 'Failed',
      kindAll: 'Mix',
      kindSound: 'Sound',
      kindEffect: 'Effect',
      kindBgm: 'Music',
      cardsTitle: 'Asset cards',
      cardsPreparing: 'Searching the catalog…',
      cardsSearching: 'Searching for "{query}"…',
      cardsFailed: 'Asset search failed',
      cardsStatus: 'Catalog status',
      cardsSynced: 'Catalog synced',
      cardsEmpty: 'No asset to show',
      hits: '{n} hits',
      cardsMore: 'More results are available in the assets panel',
    }

    const CSS = `
.mil-root { height: 100%; min-height: 0; overflow-y: auto; background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-primary); }
.mil-wrap { box-sizing: border-box; width: 100%; max-width: 1040px; margin: 0 auto; padding: 28px 24px 56px; display: flex; flex-direction: column; gap: 18px; }
.mil-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; }
.mil-title { margin: 0; font-size: 20px; font-weight: 600; line-height: 1.35; }
.mil-sub { margin: 6px 0 0; font-size: 13px; line-height: 1.6; color: var(--dsw-alias-label-secondary); }
.mil-status { flex: none; text-align: right; font-size: 12px; line-height: 1.7; color: var(--dsw-alias-label-secondary); }
.mil-search { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; padding: 10px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 12px; background: var(--dsw-alias-bg-layer-1); }
.mil-input { flex: 1 1 240px; min-width: 0; box-sizing: border-box; padding: 9px 11px; font: inherit; font-size: 13px; color: inherit; background: var(--dsw-alias-bg-base); border: 1px solid var(--dsw-alias-border-l1); border-radius: 8px; outline: none; }
.mil-input:focus { border-color: var(--dsw-alias-brand-primary); }
.mil-scopes { display: inline-flex; gap: 2px; padding: 2px; border-radius: 8px; background: var(--dsw-alias-bg-layer-2); }
.mil-scope { padding: 6px 10px; font: inherit; font-size: 12px; color: var(--dsw-alias-label-secondary); background: transparent; border: 0; border-radius: 6px; cursor: pointer; }
.mil-scope[data-active="true"] { color: var(--dsw-alias-label-primary); background: var(--dsw-alias-bg-base); }
.mil-submit { padding: 8px 16px; font: inherit; font-size: 13px; font-weight: 500; color: #fff; background: var(--dsw-alias-brand-primary); border: 0; border-radius: 8px; cursor: pointer; }
.mil-submit:disabled { cursor: default; opacity: 0.55; }
.mil-banner { padding: 10px 12px; font-size: 12.5px; line-height: 1.6; border-radius: 10px; border: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-secondary); display: flex; flex-wrap: wrap; align-items: center; gap: 10px; }
.mil-banner[data-tone="error"] { color: var(--dsw-alias-state-error-primary); border-color: var(--dsw-alias-state-error-primary); }
.mil-banner[data-tone="ok"] { color: var(--dsw-alias-state-success-primary); border-color: var(--dsw-alias-state-success-primary); }
.mil-ghost { padding: 6px 11px; font: inherit; font-size: 12px; color: inherit; background: var(--dsw-alias-bg-layer-2); border: 1px solid var(--dsw-alias-border-l1); border-radius: 7px; cursor: pointer; }
.mil-ghost:disabled { cursor: default; opacity: 0.55; }
.mil-list { display: flex; flex-direction: column; gap: 10px; margin: 0; padding: 0; list-style: none; }
.mil-card { display: flex; gap: 12px; padding: 12px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 12px; background: var(--dsw-alias-bg-layer-1); }
.mil-card-main { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; gap: 7px; }
.mil-card-head { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.mil-badge { flex: none; padding: 2px 7px; font-size: 11px; line-height: 1.5; border-radius: 5px; color: var(--dsw-alias-label-secondary); background: var(--dsw-alias-bg-layer-2); }
.mil-badge[data-kind="sound"] { color: var(--dsw-alias-brand-primary); }
.mil-badge[data-kind="effect"] { color: var(--dsw-alias-state-warn-primary); }
.mil-badge[data-kind="bgm"] { color: var(--dsw-alias-state-success-primary); }
.mil-card-title { font-size: 14px; font-weight: 600; line-height: 1.45; word-break: break-word; }
.mil-meta { margin-left: auto; display: inline-flex; align-items: center; gap: 8px; font-size: 11.5px; color: var(--dsw-alias-label-secondary); }
.mil-flag { padding: 1px 6px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 5px; }
.mil-desc { margin: 0; font-size: 12.5px; line-height: 1.65; color: var(--dsw-alias-label-secondary); white-space: pre-wrap; }
.mil-kws { display: flex; flex-wrap: wrap; gap: 5px; }
.mil-kw { padding: 1px 7px; font-size: 11px; line-height: 1.6; border-radius: 999px; color: var(--dsw-alias-label-secondary); background: var(--dsw-alias-bg-layer-2); }
.mil-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.mil-act { padding: 5px 10px; font: inherit; font-size: 12px; color: var(--dsw-alias-label-primary); background: var(--dsw-alias-bg-base); border: 1px solid var(--dsw-alias-border-l1); border-radius: 7px; cursor: pointer; text-decoration: none; }
.mil-act[data-active="true"] { color: #fff; background: var(--dsw-alias-brand-primary); border-color: var(--dsw-alias-brand-primary); }
.mil-id { font-size: 11.5px; color: var(--dsw-alias-label-secondary); font-variant-numeric: tabular-nums; }
.mil-thumb { flex: none; width: 84px; height: 84px; object-fit: cover; border-radius: 9px; background: var(--dsw-alias-bg-layer-2); border: 1px solid var(--dsw-alias-border-l1); }
.mil-detail { display: flex; flex-direction: column; gap: 8px; padding-top: 4px; border-top: 1px dashed var(--dsw-alias-border-l1); }
.mil-detail h3 { margin: 8px 0 0; font-size: 11.5px; font-weight: 600; letter-spacing: 0.02em; text-transform: uppercase; color: var(--dsw-alias-label-secondary); }
.mil-detail ul { margin: 0; padding-left: 18px; font-size: 12.5px; line-height: 1.7; color: var(--dsw-alias-label-secondary); }
.mil-video { width: 100%; max-width: 360px; border-radius: 9px; background: #000; }
.mil-more { align-self: center; }
`

    function detectLocale() {
      const supported = ['zh-CN', 'zh-TW', 'en-US', 'ja-JP', 'ru-RU']
      const language = typeof document !== 'undefined' ? document.documentElement.lang : ''
      if (supported.includes(language)) return language
      const short = String(language || '').toLowerCase()
      if (short.startsWith('zh-tw') || short.startsWith('zh-hant')) return 'zh-TW'
      if (short.startsWith('zh')) return 'zh-CN'
      if (short.startsWith('ja')) return 'ja-JP'
      if (short.startsWith('ru')) return 'ru-RU'
      if (short) return 'en-US'
      return 'zh-CN'
    }

    function fill(template, values) {
      return template.replace(/\{(\w+)\}/gu, (match, key) => (key in values ? String(values[key]) : match))
    }

    function kindKey(kind) {
      return kind === 'sound' ? 'kindSound' : kind === 'effect' ? 'kindEffect' : kind === 'bgm' ? 'kindBgm' : 'kindAll'
    }

    function duration(value) {
      return typeof value === 'number' && Number.isFinite(value) && value > 0
        ? `${value < 10 ? value.toFixed(1) : Math.round(value)}s`
        : ''
    }

    async function callApi(resource, params) {
      const search = new URLSearchParams()
      for (const [key, value] of Object.entries(params || {})) {
        if (value !== undefined && value !== null && value !== '') search.set(key, String(value))
      }
      const query = search.toString()
      let response
      try {
        response = await fetch(`${API}${resource}${query ? `?${query}` : ''}`, {
          headers: { accept: 'application/json' },
          credentials: 'same-origin',
        })
      } catch (error) {
        throw new Error(`${resource}: ${String(error && error.message || error)}`)
      }
      let body = null
      try {
        body = await response.json()
      } catch {
        body = null
      }
      if (!response.ok || (body && typeof body.error === 'string')) {
        throw new Error((body && body.error) || `HTTP ${response.status}`)
      }
      return body
    }

    /** The sidebar glyph: a sound wave inside a rounded card. */
    function PanelIcon(props) {
      const size = typeof props.size === 'number' ? props.size : 20
      const active = props.active === true
      return h('svg', {
        width: size,
        height: size,
        viewBox: '0 0 24 24',
        fill: 'none',
        'aria-hidden': true,
        style: { display: 'block', pointerEvents: 'none' },
      }, h('rect', {
        x: 2.75, y: 3.75, width: 18.5, height: 16.5, rx: 4.25,
        stroke: 'currentColor', strokeWidth: active ? 1.9 : 1.6, opacity: active ? 1 : 0.82,
      }), h('path', {
        d: 'M7.4 12.6v-1.2M10.1 15V9M12.8 16.6V7.4M15.5 14V10M18.2 12.9v-1.8',
        stroke: 'currentColor',
        strokeWidth: 1.7,
        strokeLinecap: 'round',
      }))
    }

    function Detail({ item, t }) {
      const description = typeof item.fullDescription === 'string' && item.fullDescription.length > item.description?.length
        ? item.fullDescription
        : item.description
      const uses = Array.isArray(item.suggestedUses) ? item.suggestedUses : []
      const keys = Array.isArray(item.keywords) ? item.keywords : []
      return h('div', { className: 'mil-detail' },
        description ? h('p', { className: 'mil-desc' }, description) : null,
        keys.length ? h('div', null,
          h('h3', null, t('keys')),
          h('div', { className: 'mil-kws' }, keys.map((key, index) => h('span', { className: 'mil-kw', key: `${key}-${index}` }, key))),
        ) : null,
        uses.length ? h('div', null,
          h('h3', null, t('uses')),
          h('ul', null, uses.map((use, index) => h('li', { key: `${use}-${index}` }, use))),
        ) : null,
        item.media && item.media.video
          ? h('video', { className: 'mil-video', src: item.media.video, controls: true, preload: 'none', playsInline: true })
          : null,
        item.media && item.media.player
          ? h('iframe', {
            className: 'mil-video',
            src: item.media.player,
            height: 86,
            frameBorder: 0,
            allow: 'encrypted-media',
            title: item.title,
          })
          : null,
      )
    }

    function Card({ item, t, playingId, onTogglePlay }) {
      const [open, setOpen] = useState(false)
      const [thumbFailed, setThumbFailed] = useState(false)
      const media = item.media || {}
      const audio = typeof media.audio === 'string' ? media.audio : ''
      const cover = typeof media.cover === 'string' ? media.cover : ''
      const icon = typeof media.icon === 'string' ? media.icon : ''
      const thumb = cover || icon
      const playing = playingId === item.resourceId
      return h('li', { className: 'mil-card' },
        h('div', { className: 'mil-card-main' },
          h('div', { className: 'mil-card-head' },
            h('span', { className: 'mil-badge', 'data-kind': item.kind }, t(kindKey(item.kind))),
            h('span', { className: 'mil-card-title' }, item.title || item.resourceId),
            h('span', { className: 'mil-meta' },
              item.audioMatch ? h('span', { className: 'mil-flag' }, t('audioMatch')) : null,
              item.matchType === 'suggestion' ? h('span', { className: 'mil-flag' }, t('suggestion')) : null,
              duration(item.duration) ? h('span', null, duration(item.duration)) : null,
            ),
          ),
          item.summary || item.description
            ? h('p', { className: 'mil-desc' }, item.summary || item.description)
            : null,
          Array.isArray(item.keywords) && item.keywords.length
            ? h('div', { className: 'mil-kws' }, item.keywords.slice(0, 8).map((key, index) => h('span', { className: 'mil-kw', key: `${key}-${index}` }, key)))
            : null,
          h('div', { className: 'mil-actions' },
            audio ? h('button', {
              type: 'button',
              className: 'mil-act',
              'data-active': playing,
              onClick: () => onTogglePlay(item),
            }, playing ? t('pause') : t('play')) : null,
            h('button', {
              type: 'button',
              className: 'mil-act',
              onClick: () => setOpen(current => !current),
            }, open ? t('collapse') : t('detail')),
            item.href ? h('a', {
              className: 'mil-act',
              href: item.href,
              target: '_blank',
              rel: 'noreferrer noopener',
            }, t('open')) : null,
            media.song ? h('a', {
              className: 'mil-act',
              href: media.song,
              target: '_blank',
              rel: 'noreferrer noopener',
            }, t('music')) : null,
            h('span', { className: 'mil-id' }, item.resourceId),
          ),
          open ? h(Detail, { item, t }) : null,
        ),
        thumb && !thumbFailed
          ? h('img', {
            className: 'mil-thumb',
            src: thumb,
            alt: '',
            loading: 'lazy',
            onError: () => setThumbFailed(true),
          })
          : null,
      )
    }

    /** Card-surface styles: the transcript column is narrower than the panel page. */
    const TOOL_CSS = `
.mic-root { display: flex; flex-direction: column; gap: 8px; font-size: 13px; line-height: 1.5; color: var(--dsw-alias-label-primary); }
.mic-row { display: flex; align-items: center; gap: 8px; min-width: 0; min-height: 22px; }
.mic-icon { display: inline-flex; flex: none; color: var(--dsw-alias-label-secondary); }
.mic-title { flex: none; font-weight: 500; }
.mic-sep { flex: none; width: 3px; height: 3px; border-radius: 50%; background: var(--dsw-alias-label-secondary); opacity: 0.55; }
.mic-summary { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--dsw-alias-label-secondary); }
.mic-row[data-expandable="true"] { cursor: pointer; }
.mic-row[data-expandable="true"]:hover .mic-summary { color: var(--dsw-alias-label-primary); }
.mic-chev { flex: none; font-size: 11px; line-height: 1; color: var(--dsw-alias-label-secondary); }
.mic-tail { margin: 12px 0 4px; }
.mic-frame { display: block; width: 100%; border: 0; border-radius: 12px; background: #fff; color-scheme: light; }
.mic-frame-wrap { position: relative; }
.mic-frame-panel { display: flex; }
.mic-frame-wrap[data-mode="fullscreen"] { position: fixed; inset: 0; z-index: 1200; display: flex; align-items: center; justify-content: center; padding: 24px; background: rgba(8, 10, 14, 0.42); }
.mic-frame-wrap[data-mode="fullscreen"] .mic-frame-panel { width: min(1360px, 94vw); height: min(920px, 90vh); overflow: hidden; background: #fff; border-radius: 14px; box-shadow: 0 24px 64px rgba(0, 0, 0, 0.42); }
.mic-frame-wrap[data-mode="fullscreen"] .mic-frame { flex: 1 1 auto; height: 100% !important; border-radius: 0; }
.mic-frame-close { position: absolute; top: 10px; right: 12px; width: 34px; height: 34px; padding: 0; font-size: 15px; line-height: 1; color: #f4f6fa; background: rgba(20, 24, 32, 0.55); border: 1px solid rgba(255, 255, 255, 0.24); border-radius: 50%; cursor: pointer; }
.mic-frame-close:hover { background: rgba(20, 24, 32, 0.78); }
.mic-root[data-state="error"] .mic-summary { color: var(--dsw-alias-state-error, var(--dsw-alias-label-primary)); }
.mic-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(250px, 1fr)); gap: 8px; margin: 0; padding: 0; list-style: none; }
.mic-card { display: flex; flex-direction: column; gap: 6px; min-width: 0; padding: 10px 11px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 10px; background: var(--dsw-alias-bg-layer-1); }
.mic-card-top { display: flex; align-items: center; gap: 6px; min-width: 0; }
.mic-badge { flex: none; padding: 1px 6px; border-radius: 5px; font-size: 11px; line-height: 16px; color: var(--dsw-alias-label-secondary); background: var(--dsw-alias-bg-layer-2); }
.mic-badge[data-kind="sound"] { color: var(--dsw-alias-brand-primary); }
.mic-name { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12.5px; font-weight: 500; }
.mic-dur { flex: none; font-size: 11px; color: var(--dsw-alias-label-secondary); font-variant-numeric: tabular-nums; }
.mic-sum { display: -webkit-box; margin: 0; overflow: hidden; font-size: 12px; line-height: 1.55; color: var(--dsw-alias-label-secondary); -webkit-line-clamp: 3; -webkit-box-orient: vertical; }
.mic-acts { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.mic-act { padding: 2px 8px; font: inherit; font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-primary); text-decoration: none; background: var(--dsw-alias-bg-layer-2); border: 0; border-radius: 6px; cursor: pointer; }
.mic-act:hover { background: var(--dsw-alias-bg-layer-1); }
.mic-act[data-active="true"] { color: #fff; background: var(--dsw-alias-brand-primary); }
.mic-id { margin-left: auto; font-size: 11px; font-variant-numeric: tabular-nums; color: var(--dsw-alias-label-secondary); }
.mic-detail { display: flex; flex-direction: column; gap: 6px; padding-top: 6px; border-top: 1px solid var(--dsw-alias-border-l1); }
.mic-kws { display: flex; flex-wrap: wrap; gap: 4px; }
.mic-kw { padding: 1px 6px; font-size: 11px; line-height: 17px; border-radius: 5px; color: var(--dsw-alias-label-secondary); background: var(--dsw-alias-bg-layer-2); }
.mic-video { width: 100%; border: 0; border-radius: 8px; background: #000; }
.mic-pre { max-height: 180px; margin: 0; padding: 8px; overflow: auto; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11.5px; line-height: 1.6; white-space: pre-wrap; word-break: break-word; color: var(--dsw-alias-label-secondary); background: var(--dsw-alias-bg-layer-2); border-radius: 8px; }
`

    function ToolGlyph() {
      return h('svg', {
        width: 14,
        height: 14,
        viewBox: '0 0 24 24',
        fill: 'none',
        'aria-hidden': true,
        style: { display: 'block' },
      }, h('path', {
        d: 'M7.4 12.6v-1.2M10.1 15V9M12.8 16.6V7.4M15.5 14V10M18.2 12.9v-1.8',
        stroke: 'currentColor',
        strokeWidth: 1.7,
        strokeLinecap: 'round',
      }))
    }

    /** Read one logged argument string, tolerating a truncated streaming prefix. */
    function readArgs(raw) {
      if (typeof raw !== 'string' || !raw) return {}
      try {
        const parsed = JSON.parse(raw)
        return parsed && typeof parsed === 'object' ? parsed : {}
      } catch {
        return {}
      }
    }

    /** Flatten a settled tool result to its text, for the fallback body. */
    function resultText(block) {
      const content = block && Array.isArray(block.content) ? block.content : []
      const parts = []
      for (const item of content) {
        if (item && item.type === 'text' && typeof item.text === 'string') parts.push(item.text)
        else if (item) parts.push(JSON.stringify(item))
      }
      if (!parts.length && block && block.error) {
        parts.push(`${block.error.name || 'error'}: ${block.error.code || ''}`)
      }
      return parts.join('\n').trim()
    }

    /**
     * Card payload of one settled call: the Host's presentation projection when
     * present, otherwise the result text itself when it is a JSON record. The
     * second arm keeps cards working for calls logged before this projection
     * existed, without a second catalog read.
     */
    function cardData(block) {
      const meta = block && block.meta && typeof block.meta === 'object' ? block.meta : null
      if (meta && Array.isArray(meta.items) && meta.items.length) return meta
      const text = resultText(block)
      if (!text || text.charAt(0) !== '{') return null
      try {
        const parsed = JSON.parse(text)
        if (parsed && Array.isArray(parsed.items) && parsed.items.length) {
          return {
            total: typeof parsed.total === 'number' ? parsed.total : parsed.items.length,
            nextCursor: typeof parsed.nextCursor === 'string' ? parsed.nextCursor : null,
            items: parsed.items,
          }
        }
      } catch {
        /* a compact text rendering is not JSON, by design */
      }
      return null
    }

    /** One asset of a card grid: preview controls plus a disclosed detail body. */
    function AssetMiniCard({ item, t }) {
      const [open, setOpen] = useState(false)
      const [playing, setPlaying] = useState(false)
      const audioRef = useRef(null)
      const id = typeof item.id === 'string' ? item.id : String(item.resourceId || '')
      const title = typeof item.title === 'string' ? item.title : id
      const summary = typeof item.summary === 'string' && item.summary
        ? item.summary
        : (typeof item.description === 'string' ? item.description : '')
      const media = item.media || {}
      const audio = typeof media.audio === 'string' ? media.audio : ''
      useEffect(() => () => {
        const element = audioRef.current
        if (element) {
          try {
            element.pause()
          } catch {
            /* a paused element is fine */
          }
        }
      }, [])
      const togglePlay = () => {
        if (!audio) return
        const element = audioRef.current || (audioRef.current = new Audio())
        if (playing) {
          element.pause()
          setPlaying(false)
          return
        }
        element.onended = () => setPlaying(false)
        element.src = audio
        setPlaying(true)
        const started = element.play()
        if (started && typeof started.catch === 'function') started.catch(() => setPlaying(false))
      }
      const song = typeof media.song === 'string' ? media.song : ''
      const player = typeof media.player === 'string' ? media.player : ''
      const video = typeof media.video === 'string' ? media.video : ''
      const keywords = Array.isArray(item.keywords) ? item.keywords.slice(0, 8) : []
      const duration = typeof item.duration === 'number' && item.duration > 0
        ? `${item.duration < 10 ? item.duration.toFixed(1) : Math.round(item.duration)}s`
        : ''
      return h('li', { className: 'mic-card', 'data-kind': item.kind },
        h('div', { className: 'mic-card-top' },
          h('span', { className: 'mic-badge', 'data-kind': item.kind }, t(kindKey(item.kind))),
          h('span', { className: 'mic-name', title }, title),
          duration ? h('span', { className: 'mic-dur' }, duration) : null,
        ),
        summary ? h('p', { className: 'mic-sum', title: summary }, summary) : null,
        h('div', { className: 'mic-acts' },
          audio
            ? h('button', {
              type: 'button',
              className: 'mic-act',
              'data-active': playing,
              onClick: togglePlay,
            }, playing ? t('pause') : t('play'))
            : null,
          h('button', {
            type: 'button',
            className: 'mic-act',
            'data-active': open,
            onClick: () => setOpen(current => !current),
          }, open ? t('collapse') : t('detail')),
          typeof item.href === 'string'
            ? h('a', { className: 'mic-act', href: item.href, target: '_blank', rel: 'noreferrer noopener' }, t('open'))
            : null,
          song
            ? h('a', { className: 'mic-act', href: song, target: '_blank', rel: 'noreferrer noopener' }, t('music'))
            : null,
          h('span', { className: 'mic-id' }, id),
        ),
        open
          ? h('div', { className: 'mic-detail' },
            keywords.length
              ? h('div', { className: 'mic-kws' }, keywords.map((word, index) => h('span', { className: 'mic-kw', key: `${word}-${index}` }, word)))
              : null,
            video
              ? h('video', { className: 'mic-video', src: video, controls: true, preload: 'none', playsInline: true })
              : null,
            player
              ? h('iframe', {
                className: 'mic-video',
                src: player,
                height: 86,
                frameBorder: 0,
                allow: 'encrypted-media',
                title,
              })
              : null,
          )
          : null,
      )
    }

    /** The card grid shared by the Turn tail and the folded tool row. */
    function AssetCardsBody({ data, t }) {
      const items = data && Array.isArray(data.items) ? data.items : []
      if (!items.length) return null
      return h('ul', { className: 'mic-grid' }, items.map(item => {
        const id = typeof item.id === 'string' ? item.id : String(item.resourceId || '')
        return h(AssetMiniCard, { key: id, item, t })
      }))
    }

    /**
     * The `miliastra_assets` call as one process row. The cards themselves belong
     * to the Turn tail below the answer; this row keeps the count and the raw
     * result one gesture away, so a Turn whose tail cannot draw them still
     * discloses everything.
     */
    function AssetCards(props) {
      const t = typeof props.t === 'function' ? props.t : key => ZH[key] || key
      const phase = props.phase
      const block = props.block || {}
      const settled = phase === 'result'
      const running = !settled
      const [open, setOpen] = useState(false)

      const argsRaw = typeof block.argsRaw === 'string' && block.argsRaw
        ? block.argsRaw
        : (block.call && typeof block.call.argsRaw === 'string' ? block.call.argsRaw : '')
      const args = readArgs(argsRaw)
      const action = typeof args.action === 'string' ? args.action : ''
      const query = typeof args.query === 'string' ? args.query.trim() : ''
      const meta = useMemo(() => (settled ? cardData(block) : null), [settled, block])
      const items = meta && Array.isArray(meta.items) ? meta.items : []
      const failed = settled && (block.isError === true || block.error !== undefined)
      const text = settled ? resultText(block) : ''

      let summary
      if (running) {
        summary = query ? fill(t('cardsSearching'), { query }) : t('cardsPreparing')
      } else if (failed) {
        summary = text.split('\n')[0] || t('cardsFailed')
      } else if (items.length) {
        summary = fill(t('hits'), { n: typeof meta.total === 'number' ? meta.total : items.length })
      } else if (action === 'status') {
        summary = t('cardsStatus')
      } else if (action === 'sync') {
        summary = t('cardsSynced')
      } else {
        summary = t('cardsEmpty')
      }

      const expandable = items.length > 0 || Boolean(text)
      const toggle = () => {
        if (expandable) setOpen(current => !current)
      }

      return h('div', {
        className: 'mic-root',
        'data-tool': 'miliastra_assets',
        'data-state': failed ? 'error' : phase === 'preparing' ? 'preparing' : phase === 'start' ? 'running' : 'ok',
      },
        h('style', null, TOOL_CSS),
        h('div', {
          className: 'mic-row',
          'data-expandable': expandable || undefined,
          role: expandable ? 'button' : undefined,
          tabIndex: expandable ? 0 : undefined,
          'aria-expanded': expandable ? open : undefined,
          onClick: toggle,
          onKeyDown: event => {
            if (!expandable || (event.key !== 'Enter' && event.key !== ' ')) return
            event.preventDefault()
            toggle()
          },
        },
          h('span', { className: 'mic-icon' }, h(ToolGlyph)),
          h('span', { className: 'mic-title' }, t('cardsTitle')),
          h('span', { className: 'mic-sep', 'aria-hidden': true }),
          h('span', { className: 'mic-summary', title: summary }, summary),
          expandable ? h('span', { className: 'mic-chev', 'aria-hidden': true }, open ? '▾' : '▸') : null,
        ),
        open && items.length ? h(AssetCardsBody, { data: meta, t }) : null,
        open && !items.length && text ? h('pre', { className: 'mic-pre' }, text) : null,
      )
    }

    const CARD_KIND = 'miliastra-cards'
    /** Host route serving the bundle's own HTML result card document. */
    const FRAME_SRC = '/miliastra-assets/api/card'

    /** Map card data onto the shape the Codex result card app reads. */
    function framePayload(data, locale) {
      const items = (Array.isArray(data && data.items) ? data.items : []).map(item => {
        const next = { ...item }
        next.resourceId = typeof item.resourceId === 'string' ? item.resourceId : String(item.id || '')
        // The card app's 编号 line, copy button and media resolution read the
        // bare numeric `id`; older cards of ours only carried the full one.
        const colon = next.resourceId.indexOf(':')
        if (typeof next.id !== 'string' || next.id.includes(':')) {
          next.id = colon >= 0 ? next.resourceId.slice(colon + 1) : String(next.id || '')
        }
        if (typeof item.description !== 'string' && typeof item.summary === 'string') {
          next.description = item.summary
        }
        if (typeof item.hasAudio !== 'boolean') {
          next.hasAudio = Boolean(item.media && item.media.audio)
        }
        return next
      })
      return {
        items,
        missingIds: Array.isArray(data && data.missingIds) ? data.missingIds : [],
        locale,
      }
    }

    /**
     * The bundle's own HTML result card, embedded for one Turn. The Host serves
     * that document; this frame drives the MCP-UI handshake the card app expects
     * (host context, display mode, size) and hands it the payload the MCP App
     * used to receive.
     */
    function ResultFrame({ data, locale, title, t }) {
      const frameRef = useRef(null)
      const [height, setHeight] = useState(460)
      const [mode, setMode] = useState('inline')
      const payload = useMemo(() => framePayload(data, locale), [data, locale])

      const post = message => {
        const frame = frameRef.current
        if (frame && frame.contentWindow) frame.contentWindow.postMessage(message, '*')
      }

      const hostContext = next => ({
        displayMode: next,
        availableDisplayModes: ['inline', 'fullscreen'],
        locale,
      })

      const leaveFullscreen = useCallback(() => {
        setMode('inline')
        post({
          jsonrpc: '2.0',
          method: 'ui/notifications/host-context-changed',
          params: hostContext('inline'),
        })
      }, [locale])

      useEffect(() => {
        if (mode !== 'fullscreen') return undefined
        const close = event => {
          if (event.key !== 'Escape' && event.key !== 'Esc') return
          event.stopPropagation()
          leaveFullscreen()
        }
        // Escape must work while the pointer focus sits inside the card, so the
        // same handler is bound to the frame document (same origin) as well.
        window.addEventListener('keydown', close, true)
        const frame = frameRef.current
        const inner = frame && frame.contentWindow && frame.contentWindow.document
        if (inner) inner.addEventListener('keydown', close, true)
        return () => {
          window.removeEventListener('keydown', close, true)
          if (inner) inner.removeEventListener('keydown', close, true)
        }
      }, [mode, leaveFullscreen])

      useEffect(() => {
        const receive = event => {
          const frame = frameRef.current
          if (!frame || event.source !== frame.contentWindow) return
          const message = event.data
          if (!message || typeof message !== 'object') return
          if (message.method === 'ui/initialize' && message.id !== undefined) {
            post({
              jsonrpc: '2.0',
              id: message.id,
              result: {
                hostContext: hostContext(mode),
                hostCapabilities: {},
              },
            })
            return
          }
          if (message.method === 'ui/request-display-mode' && message.id !== undefined) {
            const next = message.params && message.params.mode === 'fullscreen' ? 'fullscreen' : 'inline'
            setMode(next)
            post({ jsonrpc: '2.0', id: message.id, result: { mode: next } })
            return
          }
          if (message.method === 'ui/open-link' && message.id !== undefined) {
            const url = message.params && message.params.url
            if (typeof url === 'string' && url) window.open(url, '_blank', 'noopener')
            post({ jsonrpc: '2.0', id: message.id, result: {} })
            return
          }
          if (message.method === 'ui/notifications/size-changed') {
            const next = message.params && message.params.height
            if (typeof next === 'number' && Number.isFinite(next) && next > 0) {
              setHeight(Math.min(Math.max(Math.ceil(next), 200), 2400))
            }
            return
          }
          if (message.method === 'ui/resource-teardown' && message.id !== undefined) {
            post({ jsonrpc: '2.0', id: message.id, result: {} })
          }
        }
        window.addEventListener('message', receive)
        return () => window.removeEventListener('message', receive)
      }, [mode, locale])

      const seed = frame => {
        const view = frame && frame.contentWindow
        if (!view) return
        try {
          view.openai = Object.assign({}, view.openai || {}, {
            toolOutput: payload,
            openExternal: input => {
              const href = typeof input === 'string' ? input : input && input.href
              if (typeof href === 'string' && href) window.open(href, '_blank', 'noopener')
            },
          })
          view.dispatchEvent(new view.CustomEvent('openai:set_globals', {
            detail: { globals: { toolOutput: payload } },
          }))
        } catch {
          /* a frame that is not same-origin cannot be seeded */
        }
      }

      return h('div', {
        className: 'mic-frame-wrap',
        'data-mode': mode,
        ...(mode === 'fullscreen'
          ? {
            role: 'dialog',
            'aria-modal': true,
            onClick: event => {
              if (event.target === event.currentTarget) leaveFullscreen()
            },
          }
          : {}),
      },
        h('div', { className: 'mic-frame-panel' },
          h('iframe', {
            ref: frameRef,
            className: 'mic-frame',
            src: FRAME_SRC,
            title,
            style: { height: `${height}px` },
            onLoad: event => seed(event.currentTarget),
          }),
        ),
        mode === 'fullscreen'
          ? h('button', {
            type: 'button',
            className: 'mic-frame-close',
            'aria-label': t ? t('collapse') : 'Close',
            title: t ? t('collapse') : 'Close',
            onClick: leaveFullscreen,
          }, '✕')
          : null,
      )
    }

    /** Card payload carried by one `miliastra_assets` result event. */
    function cardStateOf(event) {
      const data = event && event.data ? event.data : {}
      const meta = data.meta && typeof data.meta === 'object' ? data.meta : null
      if (!meta || (meta.action !== 'search' && meta.action !== 'details')) return null
      const items = Array.isArray(meta.items) ? meta.items : []
      if (!items.length) return null
      if (typeof data.turn !== 'number' || !Number.isSafeInteger(data.turn) || data.turn < 0) return null
      return {
        turn: data.turn,
        total: typeof meta.total === 'number' ? meta.total : items.length,
        items,
        ...(typeof meta.locale === 'string' ? { locale: meta.locale } : {}),
        ...(Array.isArray(meta.missingIds) && meta.missingIds.length ? { missingIds: meta.missingIds } : {}),
      }
    }

    /**
     * Publish one Turn's asset cards as Turn-scoped Location data, so the Turn
     * tail draws them after the answer without walking the Session again.
     */
    const cardsDefinition = {
      kind: CARD_KIND,
      match(event) {
        if (!event || event.type !== 'tool/result') return null
        const state = cardStateOf(event)
        return state === null ? null : { id: String(state.turn), role: 'start' }
      },
      start(_context, match) {
        return cardStateOf(match.event) || { turn: 0, items: [] }
      },
      update(context, match) {
        return cardStateOf(match.event) || context.state
      },
      buildLocationData(context, scope) {
        if (scope !== 'turn') return null
        const state = context.state
        if (!state || !Array.isArray(state.items) || !state.items.length) return null
        return { kind: 'turn', turn: state.turn, key: CARD_KIND, value: state }
      },
    }

    /**
     * The asset cards of one completed Turn, drawn below that Turn's answer:
     * the user asks in the chat, the answer ends, and the matching assets follow
     * as cards. A Turn without a `miliastra_assets` result draws nothing.
     */
    function MiliastraTail(props) {
      const t = typeof props.t === 'function' ? props.t : key => ZH[key] || key
      const turn = props.turn
      if (!turn || !turn.data || turn.end === undefined) return null
      const data = turn.data.get(CARD_KIND)
      if (!data || !Array.isArray(data.items) || !data.items.length) return null
      return h('section', {
        className: 'mic-root mic-tail',
        'data-tool': 'miliastra_assets',
        'data-surface': 'turn-tail',
      },
        h('style', null, TOOL_CSS),
        h('div', { className: 'mic-row' },
          h('span', { className: 'mic-icon' }, h(ToolGlyph)),
          h('span', { className: 'mic-title' }, t('cardsTitle')),
          h('span', { className: 'mic-sep', 'aria-hidden': true }),
          h('span', { className: 'mic-summary' }, fill(t('hits'), {
            n: typeof data.total === 'number' ? data.total : data.items.length,
          })),
        ),
        h(ResultFrame, {
          data,
          locale: typeof data.locale === 'string' ? data.locale : 'zh-CN',
          title: t('cardsTitle'),
          t,
        }),
      )
    }

    function Page({ t }) {
      const [query, setQuery] = useState('')
      const [scope, setScope] = useState('all')
      const [items, setItems] = useState([])
      const [cursor, setCursor] = useState(null)
      const [total, setTotal] = useState(0)
      const [busy, setBusy] = useState(false)
      const [syncing, setSyncing] = useState(false)
      const [error, setError] = useState('')
      const [notice, setNotice] = useState('')
      const [searched, setSearched] = useState(false)
      const [status, setStatus] = useState(null)
      const [playingId, setPlayingId] = useState(null)
      const audioRef = useRef(null)
      const locale = useMemo(detectLocale, [])

      const stopAudio = useCallback(() => {
        const audio = audioRef.current
        if (audio) {
          try {
            audio.pause()
          } catch {
            /* a paused element is fine */
          }
        }
        setPlayingId(null)
      }, [])

      useEffect(() => () => stopAudio(), [stopAudio])

      const loadStatus = useCallback(async () => {
        try {
          const next = await callApi('status')
          setStatus(next)
          setError('')
        } catch (failure) {
          setStatus(null)
          setError(String(failure.message || failure))
        }
      }, [])

      useEffect(() => {
        loadStatus()
      }, [loadStatus])

      const runSearch = useCallback(async (term, nextScope, nextCursor, append) => {
        const text = String(term || '').trim()
        if (!text) return
        setBusy(true)
        setError('')
        setNotice('')
        try {
          const result = await callApi('search', {
            query: text,
            scope: nextScope,
            locale,
            cursor: nextCursor || undefined,
          })
          setItems(current => (append ? [...current, ...(result.items || [])] : (result.items || [])))
          setCursor(result.nextCursor || null)
          setTotal(typeof result.total === 'number' ? result.total : 0)
          setSearched(true)
          stopAudio()
        } catch (failure) {
          setError(String(failure.message || failure))
        } finally {
          setBusy(false)
        }
      }, [locale, stopAudio])

      const onSubmit = event => {
        event.preventDefault()
        runSearch(query, scope, null, false)
      }

      const onTogglePlay = useCallback(item => {
        const url = item.media && item.media.audio
        if (!url) return
        const audio = audioRef.current || (audioRef.current = new Audio())
        if (playingId === item.resourceId && !audio.paused) {
          audio.pause()
          setPlayingId(null)
          return
        }
        audio.onended = () => setPlayingId(null)
        audio.src = url
        setPlayingId(item.resourceId)
        const started = audio.play()
        if (started && typeof started.catch === 'function') {
          started.catch(() => setPlayingId(null))
        }
      }, [playingId])

      const onSync = async () => {
        setSyncing(true)
        setError('')
        setNotice('')
        try {
          await callApi('sync')
          setNotice(t('synced'))
          await loadStatus()
        } catch (failure) {
          setError(String(failure.message || failure))
        } finally {
          setSyncing(false)
        }
      }

      const counts = status && status.counts ? status.counts : null

      return h('div', { className: 'mil-root' },
        h('style', null, CSS),
        h('div', { className: 'mil-wrap' },
          h('header', { className: 'mil-head' },
            h('div', null,
              h('h1', { className: 'mil-title' }, t('title')),
              h('p', { className: 'mil-sub' }, t('subtitle')),
            ),
            h('div', { className: 'mil-status' },
              status
                ? h('div', null, fill(t('version'), { release: status.release || '-' }))
                : null,
              counts
                ? h('div', null, fill(t('count'), { total: counts.total || 0 }))
                : null,
            ),
          ),
          h('form', { className: 'mil-search', onSubmit },
            h('input', {
              className: 'mil-input',
              value: query,
              placeholder: t('placeholder'),
              onChange: event => setQuery(event.target.value),
              'aria-label': t('placeholder'),
            }),
            h('div', { className: 'mil-scopes', role: 'group' },
              SCOPES.map(value => h('button', {
                key: value,
                type: 'button',
                className: 'mil-scope',
                'data-active': scope === value,
                onClick: () => setScope(value),
              }, t(value === 'all' ? 'scopeAll' : value === 'sound' ? 'scopeSound' : value === 'effect' ? 'scopeEffect' : 'scopeBgm'))),
            ),
            h('button', { className: 'mil-submit', type: 'submit', disabled: busy || !query.trim() },
              busy ? t('searching') : t('search')),
          ),
          notice ? h('div', { className: 'mil-banner', 'data-tone': 'ok' }, notice) : null,
          error
            ? h('div', { className: 'mil-banner', 'data-tone': 'error' },
              h('span', null, error),
              h('button', {
                type: 'button',
                className: 'mil-ghost',
                onClick: () => (status ? loadStatus() : loadStatus()),
              }, t('retry')),
              h('button', {
                type: 'button',
                className: 'mil-ghost',
                onClick: onSync,
                disabled: syncing,
              }, syncing ? t('syncing') : t('sync')),
            )
            : null,
          !error && !status
            ? h('div', { className: 'mil-banner' },
              h('span', null, t('emptyHint')),
              h('button', { type: 'button', className: 'mil-ghost', onClick: onSync, disabled: syncing },
                syncing ? t('syncing') : t('sync')),
            )
            : null,
          searched && !busy
            ? h('div', { className: 'mil-banner' },
              h('span', null, fill(t('total'), { n: total })),
            )
            : null,
          h('ul', { className: 'mil-list' },
            items.length
              ? items.map(item => h(Card, {
                key: item.resourceId,
                item,
                t,
                playingId,
                onTogglePlay,
              }))
              : h('li', { className: 'mil-banner' },
                h('span', null, searched ? t('noResult') : t('empty')),
              ),
          ),
          cursor
            ? h('button', {
              type: 'button',
              className: 'mil-ghost mil-more',
              disabled: busy,
              onClick: () => runSearch(query, scope, cursor, true),
            }, busy ? t('loading') : t('more'))
            : null,
        ),
      )
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        const locale = ctx.get('locale')
        let translate = key => ZH[key] || key
        if (locale) {
          ctx.effect(() => locale.register(NS, { zh: ZH, en: EN }), 'miliastra-assets: dictionaries')
          try {
            const bound = locale.bind(NS)
            translate = key => {
              const value = bound(key)
              return typeof value === 'string' && value !== key ? value : (ZH[key] || key)
            }
          } catch {
            /* keep the Chinese dictionary when the namespace is unavailable */
          }
        }
        ctx.slots.inject('tool.call.toolview', () => ctx.slots.register({
          name: 'tool.call.toolview',
          key: 'miliastra_assets',
          locale: NS,
        }, AssetCards))
        ctx.slots.inject('conversation.chat.turnTail', () => ctx.slots.register({
          name: 'conversation.chat.turnTail',
          id: 'ugc-asset-search',
          locale: NS,
          inject: () => ({ t: translate }),
        }, MiliastraTail))
        ctx.inject(['uiConversation'], inner => inner.effect(() => {
          const events = inner.uiConversation && inner.uiConversation.events
          if (!events || typeof events.register !== 'function') return () => {}
          const dispose = events.register(cardsDefinition)
          return typeof dispose === 'function' ? dispose : () => {}
        }, 'miliastra-assets: turn cards'))
        // The left-sidebar entry and its panel page are intentionally not
        // mounted: the surface is the conversation card, and the card's own
        // 展开 switches to a right-side drawer.
      },
    }
  },
})
