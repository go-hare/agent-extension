/**
 * chrome.debugger 会话管理。
 *
 * 设计要点（照搬原版踩过的坑）：
 *  1. attach 是**每 tab 一次**，不是每命令一次。反复 attach/detach 会让页面顶部
 *     那条 "XXX is debugging this browser" 横幅疯狂闪，而且有竞态。
 *  2. chrome:// 和 chrome-extension:// 拒绝 attach —— Chrome 直接报错，
 *     错误信息还很难看，不如提前拦下给个人话文案。
 *  3. 域（Runtime/Network/Page）**按需 enable**，enable 过就记住，不重复发。
 *     Network.enable 尤其贵，会开始缓冲所有请求体。
 *  4. onDetach 必须监听：用户手动点掉横幅上的 "Cancel"、或 DevTools 抢占
 *     debugger 时，我们的状态要跟着清掉，否则后续命令全部失败且不知道为什么。
 *  5. SW 会被 Chrome 随时终止，所以 attach 记录同时写 session storage，
 *     重启后能主动 detach 掉遗留会话。
 */

const PROTOCOL_VERSION = '1.3';

/** 单条 CDP 命令的超时。超过这个时间大概率是页面卡死或 debugger 掉了。 */
const COMMAND_TIMEOUT_MS = 30_000;

export type CdpDomain = 'Runtime' | 'Network' | 'Page' | 'DOM';

interface SessionState {
  tabId: number;
  attachedAt: number;
  enabled: Set<CdpDomain>;
}

const sessions = new Map<number, SessionState>();

/** attach 是异步的，并发调用要复用同一个 promise，否则会 attach 两次报错。 */
const attachInFlight = new Map<number, Promise<void>>();

export class CdpError extends Error {
  constructor(
    message: string,
    readonly tabId: number,
    readonly command?: string,
  ) {
    super(message);
    this.name = 'CdpError';
  }
}

/** 这些 scheme 下 debugger 无法工作，提前拦截给出可读文案。 */
const BLOCKED_SCHEMES = [
  'chrome://',
  'chrome-extension://',
  'chrome-untrusted://',
  'devtools://',
  'edge://',
  'about:',
  'view-source:',
];

export function isAttachableUrl(url: string | undefined): boolean {
  if (!url) return false;
  const lower = url.toLowerCase();
  if (BLOCKED_SCHEMES.some((s) => lower.startsWith(s))) return false;
  // Chrome Web Store 也禁止扩展注入
  if (lower.startsWith('https://chromewebstore.google.com')) return false;
  if (lower.startsWith('https://chrome.google.com/webstore')) return false;
  return true;
}

export function describeUnattachable(url: string | undefined): string {
  if (!url) return 'This tab has no URL yet. Wait for it to finish loading, or use navigate first.';
  return (
    `Cannot control ${new URL(url).protocol}// pages — Chrome blocks extensions from ` +
    `attaching there. Ask the user to switch to a normal http(s) page, or use navigate to open one.`
  );
}

async function getTabUrl(tabId: number): Promise<string | undefined> {
  try {
    const tab = await chrome.tabs.get(tabId);
    return tab.url;
  } catch {
    return undefined;
  }
}

export async function attach(tabId: number): Promise<void> {
  if (sessions.has(tabId)) return;

  const pending = attachInFlight.get(tabId);
  if (pending) return pending;

  const p = (async () => {
    const url = await getTabUrl(tabId);
    if (!isAttachableUrl(url)) {
      throw new CdpError(describeUnattachable(url), tabId, 'attach');
    }

    try {
      await chrome.debugger.attach({ tabId }, PROTOCOL_VERSION);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // DevTools 已经占用了这个 tab 的 debugger —— 这是最常见的失败原因
      if (/already attached|Another debugger/i.test(msg)) {
        throw new CdpError(
          'Another debugger (usually DevTools) is already attached to this tab. ' +
            'Close DevTools for this tab and try again.',
          tabId,
          'attach',
        );
      }
      throw new CdpError(`Failed to attach debugger: ${msg}`, tabId, 'attach');
    }

    sessions.set(tabId, { tabId, attachedAt: Date.now(), enabled: new Set() });
    void persistAttached();
  })();

  attachInFlight.set(tabId, p);
  try {
    await p;
  } finally {
    attachInFlight.delete(tabId);
  }
}

export async function detach(tabId: number): Promise<void> {
  if (!sessions.has(tabId)) return;
  sessions.delete(tabId);
  void persistAttached();
  try {
    await chrome.debugger.detach({ tabId });
  } catch {
    // tab 已经关了 / debugger 已经掉了 —— 无所谓
  }
}

export async function detachAll(): Promise<void> {
  await Promise.all([...sessions.keys()].map((id) => detach(id)));
}

export function isAttached(tabId: number): boolean {
  return sessions.has(tabId);
}

/** 确保某个域已 enable。幂等。 */
export async function ensureDomain(tabId: number, domain: CdpDomain): Promise<void> {
  await attach(tabId);
  const s = sessions.get(tabId);
  if (!s || s.enabled.has(domain)) return;

  const params: Record<string, unknown> =
    // Network 默认不缓存 POST body，我们要看请求内容就得显式给上限
    domain === 'Network' ? { maxPostDataSize: 65_536 } : {};

  await rawSend(tabId, `${domain}.enable`, params);
  s.enabled.add(domain);
}

export async function disableDomain(tabId: number, domain: CdpDomain): Promise<void> {
  const s = sessions.get(tabId);
  if (!s || !s.enabled.has(domain)) return;
  s.enabled.delete(domain);
  try {
    await rawSend(tabId, `${domain}.disable`, {});
  } catch {
    /* ignore */
  }
}

async function rawSend<T = unknown>(
  tabId: number,
  method: string,
  params: Record<string, unknown>,
): Promise<T> {
  const timeout = new Promise<never>((_, reject) =>
    setTimeout(
      () => reject(new CdpError(`CDP command ${method} timed out after ${COMMAND_TIMEOUT_MS}ms`, tabId, method)),
      COMMAND_TIMEOUT_MS,
    ),
  );

  const call = chrome.debugger.sendCommand({ tabId }, method, params) as Promise<T>;
  return Promise.race([call, timeout]);
}

/**
 * 发一条 CDP 命令。会自动 attach。
 *
 * 会话中途掉线（用户关了横幅）时，重试一次 attach —— 这在长任务里很常见，
 * 不重试的话整个 agent loop 就废了。
 */
export async function send<T = unknown>(
  tabId: number,
  method: string,
  params: Record<string, unknown> = {},
): Promise<T> {
  await attach(tabId);
  try {
    return await rawSend<T>(tabId, method, params);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/Detached while|not attached|Debugger is not attached/i.test(msg)) {
      sessions.delete(tabId);
      await attach(tabId);
      // 重新 attach 后之前 enable 的域全没了，调用方要自己重新 ensureDomain
      return rawSend<T>(tabId, method, params);
    }
    throw e instanceof CdpError ? e : new CdpError(msg, tabId, method);
  }
}

// ─────────────────────────── 事件 ───────────────────────────

type EventHandler = (params: unknown) => void;

/** method → handler set，按 tab 隔离 */
const listeners = new Map<number, Map<string, Set<EventHandler>>>();

export function onEvent(tabId: number, method: string, handler: EventHandler): () => void {
  let byTab = listeners.get(tabId);
  if (!byTab) {
    byTab = new Map();
    listeners.set(tabId, byTab);
  }
  let set = byTab.get(method);
  if (!set) {
    set = new Set();
    byTab.set(method, set);
  }
  set.add(handler);

  return () => {
    set!.delete(handler);
    if (set!.size === 0) byTab!.delete(method);
    if (byTab!.size === 0) listeners.delete(tabId);
  };
}

function handleEvent(
  source: chrome.debugger.DebuggerSession,
  method: string,
  params?: object,
): void {
  const tabId = source.tabId;
  if (tabId == null) return;
  const set = listeners.get(tabId)?.get(method);
  if (!set) return;
  for (const h of set) {
    try {
      h(params);
    } catch (e) {
      console.error(`[cdp] event handler for ${method} threw`, e);
    }
  }
}

function handleDetach(source: chrome.debugger.Debuggee, reason: string): void {
  const tabId = source.tabId;
  if (tabId == null) return;
  sessions.delete(tabId);
  listeners.delete(tabId);
  void persistAttached();
  if (reason !== 'target_closed') {
    console.warn(`[cdp] detached from tab ${tabId}: ${reason}`);
  }
}

let wired = false;
/** 在每个会用到 CDP 的上下文（侧栏 / SW）调用一次。 */
export function installCdpListeners(): void {
  if (wired) return;
  wired = true;
  chrome.debugger.onEvent.addListener(handleEvent);
  chrome.debugger.onDetach.addListener(handleDetach);
  chrome.tabs.onRemoved.addListener((tabId) => {
    sessions.delete(tabId);
    listeners.delete(tabId);
  });
}

// ─────────────── SW 重启后的遗留会话清理 ───────────────

const ATTACHED_KEY = 'cdpAttachedTabs';

async function persistAttached(): Promise<void> {
  try {
    await chrome.storage.session.set({ [ATTACHED_KEY]: [...sessions.keys()] });
  } catch {
    /* session storage 在某些上下文不可用 */
  }
}

/**
 * SW 冷启动时调用：把上次遗留的 attach 全部 detach 掉。
 * 不做这一步的话，用户会看到一条永远消不掉的 "being debugged" 横幅。
 */
export async function reclaimStaleSessions(): Promise<void> {
  try {
    const { [ATTACHED_KEY]: ids } = await chrome.storage.session.get(ATTACHED_KEY);
    if (!Array.isArray(ids)) return;
    await Promise.all(
      ids.map(async (id: number) => {
        try {
          await chrome.debugger.detach({ tabId: id });
        } catch {
          /* already gone */
        }
      }),
    );
    await chrome.storage.session.remove(ATTACHED_KEY);
  } catch {
    /* ignore */
  }
}
