import { defineManifest } from '@crxjs/vite-plugin';
import pkg from './package.json' with { type: 'json' };

/**
 * MV3 manifest.
 *
 * 与原版 Claude in Chrome 1.0.81 的差异（有意为之）：
 *  - 不带 `key`：原版内嵌的是 Anthropic 官方扩展公钥，沿用会导致扩展 ID 冲突 /
 *    被官方商店版覆盖。这里留空，Chrome 在 load unpacked 时按路径派生 ID。
 *  - 不带 `update_url`：不走 Chrome Web Store 更新通道。
 *  - `externally_connectable` 去掉了 claude.ai（本项目不接官方站点）。
 *  - `options_page` 指向自己的配置页（Base URL + API Key）。
 */
export default defineManifest({
  manifest_version: 3,
  // chrome.i18n — full ~55-locale set under `_locales/*/messages.json`
  name: '__MSG_extName__',
  version: pkg.version,
  description: '__MSG_extDescription__',
  minimum_chrome_version: '116',
  default_locale: 'en',

  icons: {
    '128': 'public/icons/icon-128.png',
  },

  action: {
    default_title: '__MSG_actionTitle__',
  },

  background: {
    service_worker: 'src/background/index.ts',
    type: 'module',
  },

  options_page: 'src/options/index.html',

  side_panel: {
    default_path: 'src/sidepanel/index.html',
  },

  commands: {
    'toggle-side-panel': {
      description: '__MSG_commandTogglePanel__',
      suggested_key: {
        default: 'Ctrl+E',
        mac: 'Command+E',
      },
    },
  },

  content_scripts: [
    {
      // a11y 树生成器：必须 document_start + all_frames，
      // 因为 read_page/find 可能在页面脚本改动 DOM 之前就被调用。
      matches: ['<all_urls>'],
      all_frames: true,
      run_at: 'document_start',
      js: ['src/content/accessibilityTree.ts'],
    },
    {
      // "agent 正在操作此页面" 的视觉指示器：只在顶层 frame，晚一点注入。
      matches: ['<all_urls>'],
      all_frames: false,
      run_at: 'document_idle',
      js: ['src/content/agentIndicator.ts'],
    },
    // Teach Claude uses ephemeral chrome.scripting.executeScript injects
    // (official injectElementSelector) — no permanent content script.
  ],

  host_permissions: ['<all_urls>'],

  permissions: [
    'sidePanel',
    'storage',
    'unlimitedStorage',
    'activeTab',
    'tabs',
    'tabGroups',
    'scripting',
    'debugger',
    'webNavigation',
    'declarativeNetRequestWithHostAccess',
    'offscreen',
    'notifications',
    'alarms',
    'downloads',
    // Official open MCP: Desktop / Claude Code connectNative → tool_request
    'nativeMessaging',
  ],

  content_security_policy: {
    // script-src 'self' —— 不允许 inline script，所有页面入口都必须是外部 module。
    // connect-src 必须含 http: —— 自建中转站常见 http://IP:port（无 TLS）。
    // 只写 https: 时，扩展页 fetch 会被 CSP 直接拦成 "Failed to fetch"，
    // 表现成"中转站挂了"，其实请求根本没出浏览器。
    extension_pages:
      "script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https: http:; font-src 'self' data:; connect-src 'self' https: http: wss: ws:;",
  },

  /*
   * ⚠️ 这里**只列 icons**，别把 fonts 加回来。
   *
   * web_accessible_resources 管的是"**网页**能不能读扩展里的文件"
   * （即 content script 注入的 DOM、或页面自己发起的请求）。
   * 扩展自己的页面（sidepanel / options）加载自己的资源**从来不需要** WAR。
   *
   * 字体走的是 CSS 管线：theme.css 里的 `url('/public/fonts/X.woff2')`
   * 在构建时被 Vite 解析成带 hash 的 `/assets/X-<hash>.woff2`，
   * 由 sidepanel 页面（extension page，CSP `font-src 'self'`）直接加载。
   * 之前把 `public/fonts/*` 也写进 WAR，结果 crxjs 又**原样**发射了一份到
   * `dist/public/fonts/`，同一批字体在包里存在两份、多占 572KB，
   * 而且没有任何代码引用后面那份。唯一用到字体的 content script
   * （agentIndicator）用的是 system-ui，不需要 Anthropic 字体。
   *
   * 留下的这一条其实是借 WAR 当"**请把这个文件打进包**"的开关：
   * `logo.svg` 只被 `chrome.runtime.getURL('public/icons/logo.svg')` 这种
   * **运行时字符串**引用，Vite 的静态分析追不到，不在 manifest 里声明就不会
   * 被发射。（加载它的是 sidepanel —— extension page 读自己扩展的资源本来
   * 不需要 WAR，这里纯粹为了让它进包。）
   *
   * 写成精确路径而不是 `public/icons/*`，是为了避开
   * `icon-128.png` 被**发射两次**（一次来自上面的 `icons`，一次来自 glob），
   * 那会让构建打出 "overwrites a previously emitted file"。
   * icon-128.png 由 `icons` 声明就够了，`background/index.ts` 里
   * 通知用的 getURL 照样能取到 —— 文件在包里就行，与 WAR 无关。
   *
   * `public/img/*` 也去掉了：那批图（login/shortcuts/slack…）是从原版复制来的，
   * 当前代码一处都没引用，留在 WAR 里等于往包里塞 1.1MB 死文件。
   * 文件本身还在 `public/img/`，将来真要用时把 glob 加回来即可。
   */
  web_accessible_resources: [
    {
      matches: ['<all_urls>'],
      // logo + onboarding art (pin tip / cowork explainer). Paths must be
      // exact — globs re-emit icon-128 and bloat the package.
      resources: [
        'public/icons/logo.svg',
        'public/img/extension-light-min.svg',
        'public/img/extension-dark-min.svg',
        'public/img/cowork_chrome_light.png',
        'public/img/cowork_chrome_dark.png',
        // Teach Claude intro hero (runtime getURL — not statically analyzable)
        'public/img/record-workflow-hero.png',
        // Tab group onboarding / secondary-tab art
        'public/img/tabgrp.svg',
        'public/img/tabgrp_dark.svg',
        // Offscreen notification sound (official OFFSCREEN_PLAY_SOUND)
        'public/sounds/notification.mp3',
      ],
      use_dynamic_url: false,
    },
  ],
});
