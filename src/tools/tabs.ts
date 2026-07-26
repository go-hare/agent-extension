/**
 * Tab 管理 + content script 通信。
 *
 * 两个反复出现的坑，集中在这里处理：
 *
 *  1. **模型给的 tabId 经常是过期的。** 它可能引用三轮之前的 tab，那个 tab
 *     早就被关了。所以每次都要 `getEffectiveTabId` 兜底回当前 tab，
 *     而不是直接抛 "No tab with id 123"。
 *
 *  2. **content script 不一定在。** manifest 声明的 content script 只在
 *     *安装/更新之后新打开的页面* 里自动注入。用户装完扩展不刷新页面，
 *     老 tab 里什么都没有。所以每次通信前先 ping，失败就用 scripting API 补注入。
 */

import type { TabContext, TabInfo } from '@/shared/types';
import { isOperableUrl } from '@/permissions/manager';

/** content script 的注入路径。由 @crxjs 在构建时重写成真实产物名。 */
const A11Y_SCRIPT = 'src/content/accessibilityTree.ts';

/**
 * 解析模型给的 tabId。
 *
 * 规则：给了且有效就用给的；给了但无效（已关闭）就报错让模型重新 tabs_context；
 * 没给就用侧栏当前锚定的 tab。
 *
 * 为什么无效时报错而不是静默回退：模型说"在 tab 5 上点提交"，
 * 结果我们在 tab 9 上点了 —— 这比报错危险得多。
 */
export async function getEffectiveTabId(
  requested: number | undefined,
  fallback: number,
): Promise<number> {
  if (requested === undefined || requested === null) return fallback;
  if (requested === fallback) return fallback;

  try {
    const tab = await chrome.tabs.get(requested);
    if (tab?.id !== undefined) return tab.id;
  } catch {
    /* 落到下面报错 */
  }
  throw new Error(
    `Tab ${requested} no longer exists. Call tabs_context to get the current list of tabs.`,
  );
}

export async function getTab(tabId: number): Promise<chrome.tabs.Tab> {
  const tab = await chrome.tabs.get(tabId);
  if (!tab) throw new Error(`Tab ${tabId} not found.`);
  return tab;
}

/** 拿 tab 的 URL；没有就报一个模型能理解的错。 */
export async function getTabUrl(tabId: number): Promise<string> {
  const tab = await getTab(tabId);
  const url = tab.url ?? tab.pendingUrl;
  if (!url) {
    throw new Error(
      `Tab ${tabId} has no URL yet — it may still be loading. Wait a second and retry.`,
    );
  }
  return url;
}

function toTabInfo(t: chrome.tabs.Tab): TabInfo {
  const url = t.url ?? t.pendingUrl ?? '';
  return {
    tabId: t.id ?? -1,
    url,
    title: t.title ?? '',
    active: Boolean(t.active),
    windowId: t.windowId,
    groupId: t.groupId !== undefined && t.groupId !== -1 ? t.groupId : undefined,
    attachable: isOperableUrl(url),
  };
}

/**
 * 列出模型可以操作的 tab。
 *
 * 有意**不列出所有窗口的所有 tab**：那会把用户在别的窗口开的私人页面
 * （邮箱、网银）标题一并送进模型上下文。只列当前窗口。
 */
export async function listTabs(currentTabId: number): Promise<TabInfo[]> {
  let windowId: number | undefined;
  try {
    windowId = (await chrome.tabs.get(currentTabId)).windowId;
  } catch {
    /* 当前 tab 已关闭，退化到当前窗口 */
  }

  const tabs = await chrome.tabs.query(
    windowId !== undefined ? { windowId } : { currentWindow: true },
  );
  return tabs.filter((t) => t.id !== undefined).map(toTabInfo);
}

export async function buildTabContext(
  currentTabId: number,
  executedOnTabId?: number,
): Promise<TabContext> {
  const availableTabs = await listTabs(currentTabId);
  return {
    currentTabId,
    executedOnTabId,
    availableTabs,
    tabCount: availableTabs.length,
  };
}

/** 给模型看的 tab 列表文本。比 JSON 省 token，也更好读。 */
export function formatTabs(ctx: TabContext): string {
  const lines = ctx.availableTabs.map((t) => {
    const marks: string[] = [];
    if (t.tabId === ctx.currentTabId) marks.push('current');
    if (t.active) marks.push('active');
    if (!t.attachable) marks.push('not operable');
    const suffix = marks.length ? ` (${marks.join(', ')})` : '';
    return `  [${t.tabId}] ${t.title || '(untitled)'}${suffix}\n      ${t.url}`;
  });
  return `${ctx.tabCount} tab(s):\n${lines.join('\n')}`;
}

// ───────────────────── content script 通信 ─────────────────────

/**
 * 给 content script 发消息，必要时先补注入。
 *
 * frameId 0 = 只发给主框架。a11y 树是 all_frames 注入的，如果不指定 frameId，
 * 每个 iframe 都会回一份，chrome.tabs.sendMessage 只取第一个回复 —— 那个
 * 很可能是某个广告 iframe 的空树。
 */
export async function sendToPage<T>(
  tabId: number,
  message: Record<string, unknown>,
  { retryInject = true }: { retryInject?: boolean } = {},
): Promise<T> {
  try {
    const res = await chrome.tabs.sendMessage(tabId, message, { frameId: 0 });
    if (res === undefined) throw new Error('empty response');
    return res as T;
  } catch (e) {
    if (!retryInject) throw wrapPageError(e, tabId);

    // 常见原因：老页面没注入 / SPA 换了 document / 页面刚导航完还没就绪
    const injected = await injectA11yScript(tabId);
    if (!injected) throw wrapPageError(e, tabId);

    try {
      const res = await chrome.tabs.sendMessage(tabId, message, { frameId: 0 });
      if (res === undefined) throw new Error('empty response after injection');
      return res as T;
    } catch (e2) {
      throw wrapPageError(e2, tabId);
    }
  }
}

function wrapPageError(e: unknown, tabId: number): Error {
  const msg = e instanceof Error ? e.message : String(e);
  if (/Receiving end does not exist|Could not establish connection/i.test(msg)) {
    return new Error(
      `Cannot reach the page script on tab ${tabId}. The page may be a restricted URL ` +
        `(chrome://, the Web Store, a PDF viewer) or still loading. ` +
        `Ask the user to open a normal website, or wait and retry.`,
    );
  }
  if (/The tab was closed|No tab with id/i.test(msg)) {
    return new Error(`Tab ${tabId} was closed. Call tabs_context for the current tabs.`);
  }
  return new Error(msg);
}

/** 补注入 a11y 脚本。返回是否成功。 */
async function injectA11yScript(tabId: number): Promise<boolean> {
  try {
    await chrome.scripting.executeScript({
      target: { tabId, frameIds: [0] },
      files: [A11Y_SCRIPT],
    });
    return true;
  } catch {
    return false;
  }
}

/** 页面里有没有活着的 content script。 */
export async function pingPage(tabId: number): Promise<boolean> {
  try {
    const res = await chrome.tabs.sendMessage<unknown, { ok?: boolean }>(
      tabId,
      { type: 'AGENT_PING' },
      { frameId: 0 },
    );
    return Boolean(res?.ok);
  } catch {
    return false;
  }
}

// ───────────────────── agent 指示器 ─────────────────────

/**
 * 显示/隐藏"agent 正在操作"指示器。
 *
 * 发送失败**必须静默** —— 指示器只是提示，页面不支持（比如 chrome://）
 * 不该让整个工具调用失败。
 */
export async function showIndicator(tabId: number, label?: string): Promise<void> {
  try {
    await chrome.tabs.sendMessage(tabId, { type: 'AGENT_INDICATOR_SHOW', label }, { frameId: 0 });
  } catch {
    /* 忽略 */
  }
}

export async function hideIndicator(tabId: number): Promise<void> {
  try {
    await chrome.tabs.sendMessage(tabId, { type: 'AGENT_INDICATOR_HIDE' }, { frameId: 0 });
  } catch {
    /* 忽略 */
  }
}

/**
 * 截图前临时隐藏指示器。
 *
 * 不这么做的话，模型每张截图上都会看到我们自己画的边框和胶囊，
 * 时间长了它会开始"解读"这个 UI，甚至试图点它。
 */
export async function withIndicatorHidden<T>(
  tabId: number,
  fn: () => Promise<T>,
): Promise<T> {
  await hideIndicator(tabId);
  // 给 CSS 过渡一点时间，否则截图里还是半透明的残影
  await delay(60);
  try {
    return await fn();
  } finally {
    /* 由调用方决定要不要再显示；这里不自动恢复，避免和后续动作打架 */
  }
}

export function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** 等页面加载完成（或超时）。navigate 之后用。 */
export async function waitForLoad(tabId: number, timeoutMs = 15_000): Promise<'complete' | 'timeout'> {
  const start = Date.now();
  // 先给导航一点启动时间，否则可能读到上一个页面残留的 complete
  await delay(120);

  while (Date.now() - start < timeoutMs) {
    try {
      const tab = await chrome.tabs.get(tabId);
      if (tab.status === 'complete') return 'complete';
    } catch {
      throw new Error(`Tab ${tabId} was closed while loading.`);
    }
    await delay(200);
  }
  return 'timeout';
}
