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
const INDICATOR_SCRIPT_SRC = 'src/content/agentIndicator.ts';

/** Prefer hashed dist assets over raw src paths when both appear in manifest. */
function preferHashedAssets(paths: string[]): string[] {
  const uniq = [...new Set(paths)];
  uniq.sort((a, b) => {
    const score = (p: string) => (p.startsWith('assets/') ? 0 : 1);
    return score(a) - score(b);
  });
  return uniq;
}

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
    if (fromManifest.length > 0) return preferHashedAssets(fromManifest);
  } catch {
    /* ignore */
  }
  return [A11Y_SCRIPT_SRC];
}

/** 解析 agent 视觉指示器 content script 路径。 */
function resolveIndicatorScriptFiles(): string[] {
  try {
    const manifest = chrome.runtime.getManifest();
    const fromManifest: string[] = [];
    for (const cs of manifest.content_scripts ?? []) {
      for (const js of cs.js ?? []) {
        if (
          /agentIndicator|agent-indicator|agent_indicator|agent-visual/i.test(js) ||
          js.includes(INDICATOR_SCRIPT_SRC)
        ) {
          fromManifest.push(js);
        }
      }
    }
    if (fromManifest.length > 0) return preferHashedAssets(fromManifest);
  } catch {
    /* ignore */
  }
  return [INDICATOR_SCRIPT_SRC];
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

// ───────────────────── content script 通信 ─────────────────────


/**
 * Messages that address a specific ref_N and must search child frames when
 * the top frame does not own that element map entry.
 * (a11y CS is all_frames; each frame has its own __agentElementMap.)
 */
const REF_SCOPED_TYPES = new Set([
  'AGENT_RESOLVE_REF',
  'AGENT_SCROLL_REF',
  'AGENT_FORM_INPUT',
  'AGENT_DELIVER_FILES',
]);

/** Namespaced child-frame refs from multi-frame read_page: `f12_ref_3`. */
const FRAME_REF_RE = /^f(\d+)_(ref_\d+)$/i;

function isRefMissingResponse(res: unknown): boolean {
  if (!res || typeof res !== 'object') return false;
  const o = res as { ok?: boolean; error?: string };
  if (o.ok === true) return false;
  const err = (o.error ?? '').toLowerCase();
  // Only treat as "try next frame" when the ref is absent in this frame —
  // not for form validation errors like "option not found".
  return (
    /was never seen|no longer exists|no element found with reference|could not resolve|unknown ref|element may have been removed|never seen on this page/i.test(
      err,
    )
  );
}

/**
 * Frame ids for multi-frame a11y / form_input (main frame first).
 * Prefer chrome.webNavigation.getAllFrames so cross-origin iframes are included
 * (content-script walk cannot see other origins). Falls back to [0] only if
 * the permission/API is unavailable.
 */
export async function listFrameIds(tabId: number): Promise<number[]> {
  try {
    if (typeof chrome !== 'undefined' && chrome.webNavigation?.getAllFrames) {
      const frames = await chrome.webNavigation.getAllFrames({ tabId });
      if (frames?.length) {
        // Stable: main frame first, then by frameId. Skip about:blank error frames
        // that have no content script (errorOccurred).
        return frames
          .filter((f) => !f.errorOccurred)
          .map((f) => f.frameId)
          .sort((a, b) => (a === 0 ? -1 : b === 0 ? 1 : a - b));
      }
    }
  } catch {
    /* fall through */
  }
  return [0];
}

async function sendToFrame<T>(
  tabId: number,
  frameId: number,
  message: Record<string, unknown>,
): Promise<T | undefined> {
  try {
    const res = await chrome.tabs.sendMessage(tabId, message, { frameId });
    if (res === undefined) return undefined;
    return res as T;
  } catch {
    return undefined;
  }
}

/**
 * Rewrite local `ref_N` tokens in a child-frame a11y tree to `f{frameId}_ref_N`
 * so model-visible refs uniquely identify the frame for form_input / resolve.
 */
function namespaceRefs(pageContent: string, frameId: number): string {
  if (frameId === 0) return pageContent;
  return pageContent.replace(/\[ref_(\d+)\]/g, `[f${frameId}_ref_$1]`);
}

/**
 * Aggregate all_frames a11y trees. Main frame first; each child frame is a
 * labeled block with namespaced refs.
 */
async function generateTreeAllFrames(
  tabId: number,
  message: Record<string, unknown>,
): Promise<{
  pageContent: string;
  viewport: { width: number; height: number };
  error?: string;
}> {
  const frames = await listFrameIds(tabId);
  const options = (message.options ?? {}) as Record<string, unknown>;
  // ref_id focus stays single-frame (caller may pass fN_ref_M via resolve path).
  const refId = typeof options.refId === 'string' ? options.refId : null;
  if (refId) {
    const m = FRAME_REF_RE.exec(refId);
    if (m) {
      const fid = Number(m[1]);
      const local = m[2]!;
      const res = await sendToFrame<{
        pageContent: string;
        viewport: { width: number; height: number };
        error?: string;
      }>(tabId, fid, {
        ...message,
        options: { ...options, refId: local },
      });
      if (!res) throw new Error('empty response');
      if (res.pageContent) {
        res.pageContent = namespaceRefs(res.pageContent, fid);
      }
      return res;
    }
  }

  type FrameTree = {
    pageContent: string;
    viewport: { width: number; height: number };
    error?: string;
    isTop?: boolean;
    url?: string;
  };

  const parts: Array<{ frameId: number; res: FrameTree }> = [];
  for (const fid of frames) {
    const res = await sendToFrame<FrameTree>(tabId, fid, message);
    if (!res || res.error) continue;
    if (!res.pageContent?.trim()) continue;
    parts.push({ frameId: fid, res });
  }

  if (parts.length === 0) {
    // Fall back to main-frame only so errors surface.
    const main = await sendToFrame<FrameTree>(tabId, 0, message);
    if (!main) throw new Error('empty response');
    return main;
  }

  const main = parts.find((p) => p.frameId === 0) ?? parts[0]!;
  const maxChars =
    typeof options.maxChars === 'number' && options.maxChars > 0
      ? options.maxChars
      : 50_000;

  const chunks: string[] = [];
  let used = 0;
  for (const { frameId, res } of parts) {
    let body = res.pageContent.trim();
    if (!body) continue;
    if (frameId !== 0) {
      body = namespaceRefs(body, frameId);
      const label = res.url ? `iframe frameId=${frameId} url=${res.url}` : `iframe frameId=${frameId}`;
      body = `[${label}]\n${body}`;
    }
    const next = (chunks.length ? '\n\n' : '') + body;
    if (used + next.length > maxChars && chunks.length > 0) {
      chunks.push(
        `\n[output truncated — ${parts.length - chunks.length} more frame(s) omitted. Pass a larger max_chars or ref_id.]`,
      );
      break;
    }
    chunks.push(body);
    used += next.length;
  }

  return {
    pageContent: chunks.join('\n\n'),
    viewport: main.res.viewport,
  };
}

/**
 * Resolve a model-facing ref to {frameId, localRef}.
 * - `f12_ref_3` → frame 12, local `ref_3`
 * - `ref_3` → walk all frames (legacy / main-frame refs)
 */
function parseFrameRef(refId: string | undefined): { frameId?: number; localRef: string } | null {
  if (!refId || typeof refId !== 'string') return null;
  const m = FRAME_REF_RE.exec(refId);
  if (m) return { frameId: Number(m[1]), localRef: m[2]! };
  return { localRef: refId };
}

/**
 * 给 content script 发消息，必要时先补注入。
 *
 * Default: frameId 0 only. a11y is all_frames — without an explicit frameId,
 * chrome.tabs.sendMessage races every iframe and may return an empty ad frame.
 *
 * - AGENT_GENERATE_TREE: aggregate all frames (namespaced child refs).
 * - Ref-scoped messages: honor `f{N}_ref_M`, else walk frames until one owns the ref.
 */
export async function sendToPage<T>(
  tabId: number,
  message: Record<string, unknown>,
  {
    retryInject = true,
    frameId,
  }: { retryInject?: boolean; frameId?: number } = {},
): Promise<T> {
  const type = typeof message.type === 'string' ? message.type : '';
  const multiFrame = frameId === undefined && REF_SCOPED_TYPES.has(type);
  const isTree = type === 'AGENT_GENERATE_TREE';

  const tryOnce = async (): Promise<T> => {
    if (frameId != null) {
      const res = await sendToFrame<T>(tabId, frameId, message);
      if (res === undefined) throw new Error('empty response');
      return res;
    }

    if (isTree) {
      return (await generateTreeAllFrames(tabId, message)) as T;
    }

    if (!multiFrame) {
      const res = await chrome.tabs.sendMessage(tabId, message, { frameId: 0 });
      if (res === undefined) throw new Error('empty response');
      return res as T;
    }

    // Ref-scoped: prefer explicit frame from namespaced ref.
    const parsed = parseFrameRef(
      typeof message.refId === 'string' ? message.refId : undefined,
    );
    if (parsed?.frameId != null) {
      const res = await sendToFrame<T>(tabId, parsed.frameId, {
        ...message,
        refId: parsed.localRef,
      });
      if (res === undefined) throw new Error('empty response');
      return res;
    }

    // Un-namespaced ref: walk frames until one knows the element.
    const frames = await listFrameIds(tabId);
    let lastMiss: T | undefined;
    let sawAny = false;
    for (const fid of frames) {
      const res = await sendToFrame<T>(tabId, fid, message);
      if (res === undefined) continue;
      sawAny = true;
      if (!isRefMissingResponse(res)) return res;
      lastMiss = res;
    }
    if (lastMiss !== undefined) return lastMiss;
    if (!sawAny) throw new Error('empty response');
    throw new Error('empty response');
  };

  try {
    return await tryOnce();
  } catch (e) {
    if (!retryInject) throw wrapPageError(e, tabId);

    const injected = await injectA11yScript(tabId);
    if (!injected) throw wrapPageError(e, tabId);

    await delay(50);

    try {
      return await tryOnce();
    } catch (e2) {
      try {
        const tab = await chrome.tabs.get(tabId);
        if (tab.status !== 'complete') {
          await waitForLoad(tabId, 8_000);
          await injectA11yScript(tabId);
          await delay(80);
          return await tryOnce();
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

// ───────────────────── agent 指示器（官方 agent-visual-indicator） ─────────────────────

/** Tabs that currently show the pulsing agent chrome (glow + phantom cursor + Stop). */
const agentIndicatorTabs = new Set<number>();

/**
 * 补注入 agent indicator（装扩展后未刷新的旧 tab / SPA document 重置后）。
 * 与 injectA11yScript 对称；指示器只需要 top frame。
 */
async function injectIndicatorScript(tabId: number): Promise<boolean> {
  try {
    const tab = await chrome.tabs.get(tabId);
    const url = tab.url ?? tab.pendingUrl ?? '';
    if (url && !isOperableUrl(url)) return false;
  } catch {
    return false;
  }

  for (const file of resolveIndicatorScriptFiles()) {
    try {
      await chrome.scripting.executeScript({
        target: { tabId, frameIds: [0] },
        files: [file],
      });
      // Verify listener is up (same race as a11y inject).
      await delay(40);
      try {
        const ping = await chrome.tabs.sendMessage<{ type: string }, { ok?: boolean }>(
          tabId,
          { type: 'AGENT_INDICATOR_PING' },
          { frameId: 0 },
        );
        if (ping?.ok) return true;
      } catch {
        // Inject reported success; listener may still be registering.
        return true;
      }
      return true;
    } catch {
      /* try next path */
    }
  }
  return false;
}

async function sendIndicator(
  tabId: number,
  msg: Record<string, unknown>,
  { retryInject = false }: { retryInject?: boolean } = {},
): Promise<void> {
  try {
    await chrome.tabs.sendMessage(tabId, msg, { frameId: 0 });
  } catch {
    if (!retryInject) return;
    const ok = await injectIndicatorScript(tabId);
    if (!ok) return;
    await delay(50);
    try {
      await chrome.tabs.sendMessage(tabId, msg, { frameId: 0 });
    } catch {
      /* chrome:// / still no CS — indicator is best-effort */
    }
  }
}

/**
 * Show official agent chrome for the whole turn (not per-action).
 * Safe to call repeatedly — content script is idempotent.
 * Retries inject when the tab was open before the extension loaded.
 *
 * `isMcp: true` (official SHOW_AGENT_INDICATORS.isMcp) suppresses the Stop
 * Claude pill — Desktop/Claude Code own the stop control.
 */
export async function showIndicator(
  tabId: number,
  _label?: string,
  opts?: { isMcp?: boolean },
): Promise<void> {
  agentIndicatorTabs.add(tabId);
  await sendIndicator(
    tabId,
    { type: 'SHOW_AGENT_INDICATORS', isMcp: opts?.isMcp === true },
    { retryInject: true },
  );
}

/** Tear down agent chrome (turn end / stop / clear). */
export async function hideIndicator(tabId: number): Promise<void> {
  agentIndicatorTabs.delete(tabId);
  await sendIndicator(tabId, { type: 'HIDE_AGENT_INDICATORS' });
}

/** Hide chrome on every tab that still has it (stop / reset). */
export async function hideAllIndicators(): Promise<void> {
  const ids = [...agentIndicatorTabs];
  agentIndicatorTabs.clear();
  await Promise.all(ids.map((id) => sendIndicator(id, { type: 'HIDE_AGENT_INDICATORS' })));
}

/**
 * Official UPDATE_PHANTOM_CURSOR — slide the orange cursor to (x, y) CSS coords
 * and wait for the ~180ms transition so the user sees the move before the click.
 */
export async function updatePhantomCursor(
  tabId: number,
  x: number,
  y: number,
): Promise<void> {
  // Soft retry: first mouse move after showIndicator may still race inject.
  await sendIndicator(
    tabId,
    { type: 'UPDATE_PHANTOM_CURSOR', x, y },
    { retryInject: true },
  );
}

/**
 * Official HIDE_FOR_TOOL_USE — tuck chrome away for a clean screenshot, then
 * SHOW_AFTER_TOOL_USE so the glow/cursor come back without restarting the turn.
 */
export async function withIndicatorHidden<T>(
  tabId: number,
  fn: () => Promise<T>,
): Promise<T> {
  await sendIndicator(tabId, { type: 'HIDE_FOR_TOOL_USE' });
  // Let opacity/display settle so the capture has no residual chrome.
  await delay(80);
  try {
    return await fn();
  } finally {
    if (agentIndicatorTabs.has(tabId)) {
      await sendIndicator(tabId, { type: 'SHOW_AFTER_TOOL_USE' });
    }
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
