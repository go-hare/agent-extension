/**
 * 侧栏入口。
 *
 * 顺序很重要，别调换：
 *
 *  1. `import '@/styles/theme.css'` —— Vite 会把它提到最前面，样式先于
 *     首帧就绪。
 *  2. `bootstrapTheme()` 在 **createRoot 之前同步执行**。CSP 是
 *     `script-src 'self'`，没法在 <head> 里塞 inline 的防闪脚本，
 *     这已经是能设置 data-mode 的最早时机了。晚一步就会白闪一帧。
 *  3. `loadSettings()` 是异步的，不能挡在 render 前面 —— 那样会为了
 *     一次 storage 读取白等一帧。App 自己会在 settings 到达后重绘。
 *
 * 不用 React.StrictMode：StrictMode 在开发模式下会把 effect 跑两遍，
 * 而 useSession 的 effect 里有 `chrome.runtime.connect` 和
 * `permissionManager.init()`。跑两遍会开两条 port，SW 那边的
 * onDisconnect 会在第一条断开时就 detachAll()，把正在用的 CDP 会话拆掉。
 */

import '@/styles/theme.css';

import { createRoot } from 'react-dom/client';
import { App } from './App';
import { McpPermissionOnlyRoot } from './McpPermissionOnly';
import { bootstrapTheme } from './theme';
import { loadSettings, watchSettings } from '@/storage/settings';
import { installCdpListeners } from '@/cdp/session';

bootstrapTheme();

const container = document.getElementById('root');
if (!container) {
  throw new Error('#root is missing from sidepanel/index.html');
}

// Official: sidepanel.html?mcpPermissionOnly=true&requestId=… is a focused
// 600×600 permission popup — not the full chat agent (no CDP / sidepanel port).
const params = new URLSearchParams(window.location.search);
const mcpPermissionOnly = params.get('mcpPermissionOnly') === 'true';

// Official EZ popup must never mount the full chat agent (no CDP / sidepanel
// port). Missing requestId is handled inside McpPermissionOnlyRoot as an error.
if (mcpPermissionOnly) {
  void loadSettings();
  createRoot(container).render(<McpPermissionOnlyRoot />);
} else {
  // Agent tools (computer/screenshot) run in the sidepanel, not the SW.
  // Without onDetach here, sessions Map stays stale after the banner is
  // dismissed → "Debugger is not attached to the tab…".
  installCdpListeners();

  // 预热同步缓存。App 内部也会 load 一次，这里提前发是为了让
  // peekSettings() 在第一次 send() 之前就有值。
  void loadSettings();
  watchSettings();

  createRoot(container).render(<App />);
}
