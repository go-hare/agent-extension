/**
 * 主题应用。
 *
 * 两个反直觉的地方，都是被扩展环境逼出来的：
 *
 * 1. **同步启动读的是 localStorage，不是 chrome.storage。**
 *    chrome.storage 全是异步的，等它 resolve 完至少过了一帧，用户会看到
 *    一次白闪（侧栏默认底色是浅色）。localStorage 在扩展页面里是同步的，
 *    所以拿它当"主题镜像"：真值仍然在 chrome.storage.local 的 settings 里，
 *    localStorage 只是一份用完即弃的缓存，丢了也只是闪一下。
 *
 * 2. **CSP 不允许 inline script**，所以没法在 <head> 里塞一段
 *    "读 storage 设 data-mode" 的脚本。只能靠 main.tsx 顶部同步调用
 *    bootstrapTheme()，这已经是能做到的最早时机。
 */

export type Mode = 'light' | 'dark' | 'system';

const MIRROR_KEY = 'agent.mode';

/** system 模式下解析成实际的 light/dark。 */
export function resolveMode(mode: Mode): 'light' | 'dark' {
  if (mode !== 'system') return mode;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function applyMode(mode: Mode): void {
  const resolved = resolveMode(mode);
  document.documentElement.dataset.theme = 'claude';
  document.documentElement.dataset.mode = resolved;
  try {
    localStorage.setItem(MIRROR_KEY, mode);
  } catch {
    /* 隐私模式下 localStorage 可能不可用；不影响功能 */
  }
}

/** 在 render 之前同步调用一次。 */
export function bootstrapTheme(): Mode {
  let stored: Mode = 'system';
  try {
    const raw = localStorage.getItem(MIRROR_KEY);
    if (raw === 'light' || raw === 'dark' || raw === 'system') stored = raw;
  } catch {
    /* ignore */
  }
  applyMode(stored);
  return stored;
}

/**
 * 跟随系统主题变化。
 *
 * 只在 mode === 'system' 时才有意义；返回取消订阅函数。
 */
export function watchSystemMode(onChange: () => void): () => void {
  const mq = window.matchMedia('(prefers-color-scheme: dark)');
  mq.addEventListener('change', onChange);
  return () => mq.removeEventListener('change', onChange);
}
