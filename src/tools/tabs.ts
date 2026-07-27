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

/**
 * content script 源码路径（开发 / crx 源映射）。
 * 生产包里真实文件是 `assets/accessibilityTree.ts-XXXX.js`，
 * 必须从 manifest.content_scripts 解析，不能写死源路径 —— 否则
 * executeScript({ files: ['src/content/…'] }) 会静默失败，
 * 表现为 read_page / get_page_text「Cannot reach the page script」。
 */
const A11Y_SCRIPT_SRC = 'src/content/accessibilityTree.ts';

/** 解析已打包的 a11y content script 路径（相对扩展根）。 */
function resolveA11yScriptFiles(): string[] {
  try {
    const manifest = chrome.runtime.getManifest();
    const fromManifest: string[] = [];
    for (const cs of manifest.content_scripts ?? []) {
      for (const js of cs.js ?? []) {
        // Match both dev source path and hashed dist asset.
        if (
          /accessibilityTree|accessibility-tree|accessibility_tree/i.test(js) ||
          js.includes(A11Y_SCRIPT_SRC)
        ) {
          fromManifest.push(js);
        }
      }
    }
    if (fromManifest.length > 0) {
      // Prefer hashed asset over raw src path when both appear.
      fromManifest.sort((a, b) => {
        const score = (p: string) => (p.startsWith('assets/') ? 0 : 1);
        return score(a) - score(b);
      });
      return [...new Set(fromManifest)];
    }
  } catch {
    /* ignore */
  }
  return [A11Y_SCRIPT_SRC];
}

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
    if (tab?.id === undefined) {
      /* fall through */
    } else {
      // 当前会话在 tab group 内时，默认禁止跨组 / 指到未分组 tab
      // （对齐官方 group-scoped context，避免泄漏同窗口其它标签）。
      try {
        const cur = await chrome.tabs.get(fallback);
        const curG = cur.groupId;
        if (curG !== undefined && curG !== -1) {
          const reqG = tab.groupId;
          if (reqG === undefined || reqG === -1 || reqG !== curG) {
            throw new Error(
              `Tab ${requested} is outside the current tab group. Call tabs_context for tabs in the current group, or switch to that tab first.`,
            );
          }
        }
      } catch (e) {
        if (e instanceof Error && /outside the current tab group|different tab group/.test(e.message)) {
          throw e;
        }
      }
      return tab.id;
    }
  } catch (e) {
    if (e instanceof Error && /outside the current tab group|different tab group/.test(e.message)) {
      throw e;
    }
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
 *
 * 若当前 tab 在某个 tab group 内，默认只列同组（对齐官方 tabs_context），
 * 避免把同窗口其它分组的标签页泄漏进上下文。
 */
export async function listTabs(currentTabId: number): Promise<TabInfo[]> {
  let windowId: number | undefined;
  let groupId: number | undefined;
  try {
    const cur = await chrome.tabs.get(currentTabId);
    windowId = cur.windowId;
    if (cur.groupId !== undefined && cur.groupId !== -1) groupId = cur.groupId;
  } catch {
    /* 当前 tab 已关闭，退化到当前窗口 */
  }

  const tabs = await chrome.tabs.query(
    windowId !== undefined ? { windowId } : { currentWindow: true },
  );
  const mapped = tabs.filter((t) => t.id !== undefined).map(toTabInfo);
  if (groupId !== undefined) {
    return mapped.filter((t) => t.groupId === groupId);
  }
  return mapped;
}

export async function buildTabContext(
  currentTabId: number,
  executedOnTabId?: number,
): Promise<TabContext> {
  const availableTabs = await listTabs(currentTabId);
  let tabGroupId: number | undefined;
  let tabGroupTitle: string | undefined;
  try {
    const cur = await chrome.tabs.get(currentTabId);
    if (cur.groupId !== undefined && cur.groupId !== -1) {
      tabGroupId = cur.groupId;
      try {
        const g = await chrome.tabGroups.get(cur.groupId);
        tabGroupTitle = g.title || undefined;
      } catch {
        /* tabGroups 权限或 API 不可用 */
      }
    }
  } catch {
    /* ignore */
  }
  return {
    currentTabId,
    executedOnTabId,
    availableTabs,
    tabCount: availableTabs.length,
    tabGroupId,
    tabGroupTitle,
  };
}

/** 给模型看的 tab 列表文本。比 JSON 省 token，也更好读。 */
export function formatTabs(ctx: TabContext): string {
  const headerBits = [`${ctx.tabCount} tab(s)`];
  if (ctx.tabGroupId !== undefined) {
    headerBits.push(
      ctx.tabGroupTitle
        ? `group "${ctx.tabGroupTitle}" (#${ctx.tabGroupId})`
        : `group #${ctx.tabGroupId}`,
    );
  }
  const lines = ctx.availableTabs.map((t) => {
    const marks: string[] = [];
    if (t.tabId === ctx.currentTabId) marks.push('current');
    if (t.active) marks.push('active');
    if (t.groupId !== undefined) marks.push(`g${t.groupId}`);
    if (!t.attachable) marks.push('not operable');
    const suffix = marks.length ? ` (${marks.join(', ')})` : '';
    return `  [${t.tabId}] ${t.title || '(untitled)'}${suffix}\n      ${t.url}`;
  });
  return `${headerBits.join(' · ')}:\n${lines.join('\n')}`;
}

/** 本侧栏会话里 agent 自建的 tab group（不吞用户原 tab）。 */
let agentGroupId: number | undefined;

export function getAgentGroupId(): number | undefined {
  return agentGroupId;
}

export function resetAgentGroup(): void {
  agentGroupId = undefined;
}

/**
 * 把 agent 新开的 tab 放进 "Agent" 分组。
 * - 当前 tab 已在用户分组 → 跟用户分组（调用方处理）
 * - 否则只把 agent 开的 tab 收进独立 Agent 组，不挪用户原 tab
 */
export async function ensureAgentTabGrouped(newTabId: number): Promise<void> {
  try {
    if (agentGroupId !== undefined) {
      await chrome.tabs.group({ tabIds: newTabId, groupId: agentGroupId });
      return;
    }
    const groupId = await chrome.tabs.group({ tabIds: newTabId });
    agentGroupId = groupId;
    try {
      await chrome.tabGroups.update(groupId, { title: 'Agent', color: 'purple' });
    } catch {
      /* title 可选 */
    }
  } catch {
    /* 分组失败不阻断建 tab */
  }
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
  // Soft preflight: if the tab was open before the extension loaded, or after
  // a soft navigation, the permanent CS may be missing — inject before first
  // real message when ping fails (avoids one wasted round-trip only when needed).
  try {
    const res = await chrome.tabs.sendMessage(tabId, message, { frameId: 0 });
    if (res === undefined) throw new Error('empty response');
    return res as T;
  } catch (e) {
    if (!retryInject) throw wrapPageError(e, tabId);

    // 常见原因：老页面没注入 / SPA 换了 document / 页面刚导航完还没就绪 /
    // 生产包 inject 路径写错（src/… 在 dist 不存在）
    const injected = await injectA11yScript(tabId);
    if (!injected) throw wrapPageError(e, tabId);

    // executeScript resolves before the new isolated world finishes registering
    // onMessage — brief yield matches official re-arm timing.
    await delay(50);

    try {
      const res = await chrome.tabs.sendMessage(tabId, message, { frameId: 0 });
      if (res === undefined) throw new Error('empty response after injection');
      return res as T;
    } catch (e2) {
      // Second chance: page still loading
      try {
        const tab = await chrome.tabs.get(tabId);
        if (tab.status !== 'complete') {
          await waitForLoad(tabId, 8_000);
          await injectA11yScript(tabId);
          await delay(80);
          const res = await chrome.tabs.sendMessage(tabId, message, { frameId: 0 });
          if (res !== undefined) return res as T;
        }
      } catch {
        /* fall through */
      }
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

/**
 * 补注入 a11y 脚本。返回是否成功。
 *
 * 依次尝试：
 *  1. manifest 里登记的真实 assets/… 路径（生产）
 *  2. 源码路径 src/content/…（crx dev / 部分构建映射）
 *  3. 主框架 + 失败时不限 frameIds（个别站点 top frameId 非 0）
 */
async function injectA11yScript(tabId: number): Promise<boolean> {
  // Restricted URLs cannot be scripted
  try {
    const tab = await chrome.tabs.get(tabId);
    const url = tab.url ?? tab.pendingUrl ?? '';
    if (url && !isOperableUrl(url)) return false;
  } catch {
    return false;
  }

  const files = resolveA11yScriptFiles();
  const attempts: Array<{ frameIds?: number[] }> = [
    { frameIds: [0] },
    {}, // all frames in tab — last resort if top frame id is unusual
  ];

  for (const file of files) {
    for (const targetExtra of attempts) {
      try {
        await chrome.scripting.executeScript({
          target: { tabId, ...targetExtra },
          files: [file],
        });
        // Verify the isolated world actually has our listener.
        try {
          const ping = await chrome.tabs.sendMessage<{ type: string }, { ok?: boolean }>(
            tabId,
            { type: 'AGENT_PING' },
            { frameId: 0 },
          );
          if (ping?.ok) return true;
        } catch {
          // Inject reported success but listener not up yet — still count as ok;
          // caller will delay + retry sendMessage.
          return true;
        }
        return true;
      } catch {
        /* try next candidate */
      }
    }
  }
  return false;
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
