/**
 * console / network / dialog 观察器。
 *
 * 三个都是"事件流转成有限缓冲"的模式。设计约束：
 *  - **必须先 enable 才收得到事件**，而且 enable 之前发生的事件永远拿不到。
 *    所以 read_console_messages 第一次调用只能拿到"从现在开始"的日志，
 *    要在返回文本里说清楚，否则模型会以为页面真的没报错。
 *  - Network.enable 会缓冲所有请求体，长时间开着很吃内存。用完要 disable。
 *  - 缓冲用环形队列，上限固定，防止一个刷屏的页面把内存吃爆。
 */

import { ensureDomain, onEvent, send, disableDomain } from './session';

const MAX_CONSOLE_ENTRIES = 500;
const MAX_NETWORK_ENTRIES = 300;

// ──────────────────────────── console ────────────────────────────

export interface ConsoleEntry {
  level: 'log' | 'info' | 'warn' | 'error' | 'debug' | 'exception';
  text: string;
  timestamp: number;
  url?: string;
  line?: number;
  stack?: string;
}

interface ConsoleBuffer {
  entries: ConsoleEntry[];
  startedAt: number;
  dispose: () => void;
}

const consoleBuffers = new Map<number, ConsoleBuffer>();

interface RemoteObject {
  type: string;
  subtype?: string;
  value?: unknown;
  description?: string;
  preview?: { description?: string };
}

function stringifyArg(a: RemoteObject): string {
  if (a.value !== undefined) {
    return typeof a.value === 'string' ? a.value : JSON.stringify(a.value);
  }
  return a.description ?? a.preview?.description ?? `[${a.type}]`;
}

function pushCapped<T>(arr: T[], item: T, cap: number): void {
  arr.push(item);
  if (arr.length > cap) arr.splice(0, arr.length - cap);
}

export async function startConsoleCapture(tabId: number): Promise<void> {
  if (consoleBuffers.has(tabId)) return;

  await ensureDomain(tabId, 'Runtime');

  const entries: ConsoleEntry[] = [];

  const offApi = onEvent(tabId, 'Runtime.consoleAPICalled', (raw) => {
    const p = raw as {
      type: string;
      args: RemoteObject[];
      timestamp: number;
      stackTrace?: { callFrames: Array<{ url: string; lineNumber: number }> };
    };
    const frame = p.stackTrace?.callFrames?.[0];
    const level =
      p.type === 'warning'
        ? 'warn'
        : (['log', 'info', 'warn', 'error', 'debug'] as const).includes(p.type as never)
          ? (p.type as ConsoleEntry['level'])
          : 'log';
    pushCapped(
      entries,
      {
        level,
        text: (p.args ?? []).map(stringifyArg).join(' '),
        timestamp: p.timestamp,
        url: frame?.url,
        line: frame?.lineNumber,
      },
      MAX_CONSOLE_ENTRIES,
    );
  });

  const offExc = onEvent(tabId, 'Runtime.exceptionThrown', (raw) => {
    const p = raw as {
      timestamp: number;
      exceptionDetails: {
        text: string;
        url?: string;
        lineNumber?: number;
        exception?: RemoteObject;
        stackTrace?: { callFrames: Array<{ functionName: string; url: string; lineNumber: number }> };
      };
    };
    const d = p.exceptionDetails;
    const desc = d.exception?.description ?? d.text;
    pushCapped(
      entries,
      {
        level: 'exception',
        text: desc,
        timestamp: p.timestamp,
        url: d.url,
        line: d.lineNumber,
        stack: d.stackTrace?.callFrames
          ?.slice(0, 5)
          .map((f) => `  at ${f.functionName || '<anonymous>'} (${f.url}:${f.lineNumber})`)
          .join('\n'),
      },
      MAX_CONSOLE_ENTRIES,
    );
  });

  consoleBuffers.set(tabId, {
    entries,
    startedAt: Date.now(),
    dispose: () => {
      offApi();
      offExc();
    },
  });
}

export function readConsole(
  tabId: number,
  opts: { levels?: ConsoleEntry['level'][]; limit?: number } = {},
): { entries: ConsoleEntry[]; capturing: boolean; startedAt?: number } {
  const buf = consoleBuffers.get(tabId);
  if (!buf) return { entries: [], capturing: false };

  let out = buf.entries;
  if (opts.levels?.length) {
    const set = new Set(opts.levels);
    out = out.filter((e) => set.has(e.level));
  }
  const limit = opts.limit ?? 100;
  return {
    entries: out.slice(-limit),
    capturing: true,
    startedAt: buf.startedAt,
  };
}

export function stopConsoleCapture(tabId: number): void {
  const buf = consoleBuffers.get(tabId);
  if (!buf) return;
  buf.dispose();
  consoleBuffers.delete(tabId);
}

/** Clear buffered console entries but keep capture running (official `clear` semantics). */
export function clearConsole(tabId: number): void {
  const buf = consoleBuffers.get(tabId);
  if (!buf) return;
  buf.entries.length = 0;
}

// ──────────────────────────── network ────────────────────────────

export interface NetworkEntry {
  requestId: string;
  url: string;
  method: string;
  resourceType?: string;
  status?: number;
  statusText?: string;
  mimeType?: string;
  /** 只在明确要求时才带上，可能含敏感数据 */
  requestBody?: string;
  errorText?: string;
  startedAt: number;
  finishedAt?: number;
}

interface NetworkBuffer {
  byId: Map<string, NetworkEntry>;
  order: string[];
  startedAt: number;
  dispose: () => void;
}

const networkBuffers = new Map<number, NetworkBuffer>();

export async function startNetworkCapture(tabId: number): Promise<void> {
  if (networkBuffers.has(tabId)) return;

  await ensureDomain(tabId, 'Network');

  const byId = new Map<string, NetworkEntry>();
  const order: string[] = [];

  const record = (id: string, patch: Partial<NetworkEntry>) => {
    const cur = byId.get(id);
    if (cur) {
      Object.assign(cur, patch);
      return;
    }
    byId.set(id, { requestId: id, url: '', method: '', startedAt: Date.now(), ...patch });
    order.push(id);
    if (order.length > MAX_NETWORK_ENTRIES) {
      const drop = order.splice(0, order.length - MAX_NETWORK_ENTRIES);
      for (const d of drop) byId.delete(d);
    }
  };

  const offReq = onEvent(tabId, 'Network.requestWillBeSent', (raw) => {
    const p = raw as {
      requestId: string;
      request: { url: string; method: string; postData?: string };
      type?: string;
      timestamp: number;
    };
    record(p.requestId, {
      url: p.request.url,
      method: p.request.method,
      resourceType: p.type,
      requestBody: p.request.postData,
      startedAt: Date.now(),
    });
  });

  const offRes = onEvent(tabId, 'Network.responseReceived', (raw) => {
    const p = raw as {
      requestId: string;
      response: { status: number; statusText: string; mimeType: string; url: string };
      type?: string;
    };
    record(p.requestId, {
      status: p.response.status,
      statusText: p.response.statusText,
      mimeType: p.response.mimeType,
      url: p.response.url,
      resourceType: p.type,
      finishedAt: Date.now(),
    });
  });

  const offFail = onEvent(tabId, 'Network.loadingFailed', (raw) => {
    const p = raw as { requestId: string; errorText: string; canceled?: boolean };
    record(p.requestId, {
      errorText: p.canceled ? 'canceled' : p.errorText,
      finishedAt: Date.now(),
    });
  });

  networkBuffers.set(tabId, {
    byId,
    order,
    startedAt: Date.now(),
    dispose: () => {
      offReq();
      offRes();
      offFail();
    },
  });
}

export function readNetwork(
  tabId: number,
  opts: {
    urlPattern?: string;
    method?: string;
    statusMin?: number;
    onlyFailed?: boolean;
    includeBody?: boolean;
    limit?: number;
  } = {},
): { entries: NetworkEntry[]; capturing: boolean; startedAt?: number } {
  const buf = networkBuffers.get(tabId);
  if (!buf) return { entries: [], capturing: false };

  let out = buf.order.map((id) => buf.byId.get(id)!).filter(Boolean);

  if (opts.urlPattern) {
    let re: RegExp;
    try {
      re = new RegExp(opts.urlPattern, 'i');
    } catch {
      re = new RegExp(opts.urlPattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    }
    out = out.filter((e) => re.test(e.url));
  }
  if (opts.method) {
    const m = opts.method.toUpperCase();
    out = out.filter((e) => e.method.toUpperCase() === m);
  }
  if (opts.statusMin != null) {
    out = out.filter((e) => (e.status ?? 0) >= opts.statusMin!);
  }
  if (opts.onlyFailed) {
    out = out.filter((e) => e.errorText != null || (e.status ?? 0) >= 400);
  }
  if (!opts.includeBody) {
    out = out.map(({ requestBody: _drop, ...rest }) => rest as NetworkEntry);
  }

  return {
    entries: out.slice(-(opts.limit ?? 60)),
    capturing: true,
    startedAt: buf.startedAt,
  };
}

export async function stopNetworkCapture(tabId: number): Promise<void> {
  const buf = networkBuffers.get(tabId);
  if (!buf) return;
  buf.dispose();
  networkBuffers.delete(tabId);
  await disableDomain(tabId, 'Network');
}

/** 抓单条响应体。默认不抓 —— 响应体可能很大而且常含敏感数据。 */
export async function getResponseBody(
  tabId: number,
  requestId: string,
): Promise<{ body: string; base64Encoded: boolean } | null> {
  try {
    return await send<{ body: string; base64Encoded: boolean }>(
      tabId,
      'Network.getResponseBody',
      { requestId },
    );
  } catch {
    // 响应体已经被丢弃（Chrome 只保留有限时间）
    return null;
  }
}

// ──────────────────────────── JS 对话框 ────────────────────────────

/**
 * alert/confirm/prompt 处理。
 *
 * 必须处理，否则一个 alert 会**永久卡住** CDP —— 对话框打开期间
 * 页面的 JS 线程停住，我们发的所有 Input/Runtime 命令都会超时，
 * 而且模型在截图里看不出问题（截图也拍不到原生对话框）。
 *
 * Official navigate.force path (mI / setBeforeunloadPolicy):
 *  - beforeunload defaults to **dismiss** (block leave) unless force=true set accept
 *  - alert/confirm/prompt still auto-accept so CDP Input cannot hang
 */
export interface DialogRecord {
  type: string;
  message: string;
  defaultPrompt?: string;
  handledAs: 'accept' | 'dismiss';
  at: number;
  url?: string;
}

export type BeforeunloadPolicy = 'accept' | 'dismiss';
export type BeforeunloadOutcome = {
  action: 'accepted' | 'dismissed';
  url: string;
  timestamp: number;
};

const dialogLog = new Map<number, DialogRecord[]>();
/** Dispose fns so re-attach / disposeObservers do not leak Page.javascriptDialogOpening. */
const dialogDisposers = new Map<number, () => void>();
const beforeunloadPolicyByTab = new Map<number, BeforeunloadPolicy>();
const beforeunloadOutcomeByTab = new Map<number, BeforeunloadOutcome>();
const beforeunloadWaitersByTab = new Map<number, () => void>();

/** Official DE.setBeforeunloadPolicy — set right before a navigation that may trip Leave site? */
export function setBeforeunloadPolicy(tabId: number, policy: BeforeunloadPolicy): void {
  beforeunloadPolicyByTab.set(tabId, policy);
  beforeunloadOutcomeByTab.delete(tabId);
  const waiter = beforeunloadWaitersByTab.get(tabId);
  if (waiter) {
    beforeunloadWaitersByTab.delete(tabId);
    waiter();
  }
}

/** Official DE.waitForBeforeunloadResolution — short window after navigate starts. */
export function waitForBeforeunloadResolution(tabId: number, timeoutMs = 300): Promise<void> {
  if (beforeunloadOutcomeByTab.get(tabId)?.action === 'dismissed') {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      beforeunloadWaitersByTab.delete(tabId);
      resolve();
    };
    beforeunloadWaitersByTab.set(tabId, finish);
    const timer = setTimeout(finish, timeoutMs);
  });
}

/** Official DE.consumeBeforeunloadOutcome — read once after wait. */
export function consumeBeforeunloadOutcome(tabId: number): BeforeunloadOutcome | undefined {
  const o = beforeunloadOutcomeByTab.get(tabId);
  if (o) beforeunloadOutcomeByTab.delete(tabId);
  beforeunloadPolicyByTab.delete(tabId);
  return o;
}

/**
 * Official mI(tabId, force, navigateFn):
 * set policy → run navigate → wait briefly → return accepted/blocked/none.
 *
 * Wait window: official default is 300ms. We use a short primary wait, then if
 * still pending and force=false, a second short poll so slow beforeunload handlers
 * are less likely to race past us (still bounded — never hang the tool).
 */
export async function runWithBeforeunloadPolicy(
  tabId: number,
  force: boolean,
  navigateFn: () => Promise<void>,
): Promise<
  | { kind: 'none' }
  | { kind: 'accepted'; suffix: string }
  | { kind: 'blocked'; error: string }
> {
  setBeforeunloadPolicy(tabId, force ? 'accept' : 'dismiss');
  await navigateFn();
  // Primary wait (official 300ms). Dismissed outcomes wake the waiter early.
  await waitForBeforeunloadResolution(tabId, 300);
  let outcome = beforeunloadOutcomeByTab.get(tabId);
  // Secondary grace: dialog sometimes opens just after the first timeout on slow pages.
  if (!outcome) {
    await waitForBeforeunloadResolution(tabId, 200);
  }
  outcome = consumeBeforeunloadOutcome(tabId);
  if (!outcome) return { kind: 'none' };
  if (outcome.action === 'accepted') {
    return {
      kind: 'accepted',
      suffix:
        ' (discarded a "Leave site?" dialog — the page had unsaved changes that are now lost)',
    };
  }
  return {
    kind: 'blocked',
    error:
      `Navigation was blocked by a "Leave site?" dialog — the page at ${outcome.url || 'this URL'} ` +
      `has unsaved changes. The page is still open and unchanged. Either address the unsaved state first, ` +
      `or retry with force: true to discard it and navigate anyway.`,
  };
}

export async function installDialogHandler(tabId: number): Promise<void> {
  await ensureDomain(tabId, 'Page');
  if (dialogLog.has(tabId)) return;
  dialogLog.set(tabId, []);

  const offDialog = onEvent(tabId, 'Page.javascriptDialogOpening', (raw) => {
    const p = raw as { type: string; message: string; defaultPrompt?: string; url?: string };
    let accept = true;
    if (p.type === 'beforeunload') {
      // Official: policy defaults to dismiss (block) unless navigate.force set accept.
      accept = (beforeunloadPolicyByTab.get(tabId) ?? 'dismiss') === 'accept';
      beforeunloadPolicyByTab.delete(tabId);
      const outcome: BeforeunloadOutcome = {
        action: accept ? 'accepted' : 'dismissed',
        url: p.url || '',
        timestamp: Date.now(),
      };
      beforeunloadOutcomeByTab.set(tabId, outcome);
      if (!accept) {
        const waiter = beforeunloadWaitersByTab.get(tabId);
        if (waiter) {
          beforeunloadWaitersByTab.delete(tabId);
          waiter();
        }
      }
    }

    dialogLog.get(tabId)?.push({
      type: p.type,
      message: p.message,
      defaultPrompt: p.defaultPrompt,
      handledAs: accept ? 'accept' : 'dismiss',
      at: Date.now(),
      url: p.url,
    });
    void send(tabId, 'Page.handleJavaScriptDialog', {
      accept,
      ...(p.type === 'prompt' ? { promptText: p.defaultPrompt ?? '' } : {}),
    }).catch(() => {});
  });

  // Main-frame navigation clears any pending beforeunload waiters (dialog never shown).
  const offNav = onEvent(tabId, 'Page.frameNavigated', (raw) => {
    const p = raw as { frame?: { parentId?: string } };
    if (p.frame?.parentId) return;
    const waiter = beforeunloadWaitersByTab.get(tabId);
    if (waiter) {
      beforeunloadWaitersByTab.delete(tabId);
      waiter();
    }
  });

  dialogDisposers.set(tabId, () => {
    offDialog();
    offNav();
  });
}

/** 取出并清空自上次调用以来发生的对话框。 */
export function drainDialogs(tabId: number): DialogRecord[] {
  const log = dialogLog.get(tabId);
  if (!log?.length) return [];
  const out = log.slice();
  log.length = 0;
  return out;
}

export function disposeObservers(tabId: number): void {
  stopConsoleCapture(tabId);
  void stopNetworkCapture(tabId);
  const off = dialogDisposers.get(tabId);
  if (off) {
    try {
      off();
    } catch {
      /* ignore */
    }
    dialogDisposers.delete(tabId);
  }
  dialogLog.delete(tabId);
  beforeunloadPolicyByTab.delete(tabId);
  beforeunloadOutcomeByTab.delete(tabId);
  const waiter = beforeunloadWaitersByTab.get(tabId);
  if (waiter) {
    beforeunloadWaitersByTab.delete(tabId);
    try {
      waiter();
    } catch {
      /* ignore */
    }
  }
}
