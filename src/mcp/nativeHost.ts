/**
 * Official open-MCP native host client (parity with Claude in Chrome 1.0.81 SW).
 *
 * Desktop / Claude Code register native messaging hosts and open a long-lived
 * port. The host drives the extension with:
 *   ping / get_status / mcp_connected / mcp_disconnected / tool_request
 *
 * We reply on the same port (pong / status_response / tool_response).
 * openclaude-local (`com.openclaude.local`) is a *different* companion (API
 * proxy only) and is not used for tool bridging.
 *
 * Reconnect policy (official-aligned):
 *  - Probe on install / startup / installNativeHost / Options reconnect
 *  - After a *successful* port drops, retry with backoff
 *  - If no host is installed, do NOT spin forever (avoids console spam + SW churn)
 */

import { handleNativeMessage, type NativeInbound, type NativeOutbound } from './bridge';
import { setMcpConnected } from './group';
import { detachAll } from '@/cdp/session';

/** Official host names, tried in order. */
export const NATIVE_HOSTS = [
  { name: 'com.anthropic.claude_browser_extension', label: 'Desktop' },
  { name: 'com.anthropic.claude_code_browser_extension', label: 'Claude Code' },
] as const;

const PING_TIMEOUT_MS = 10_000;
const STATUS_TIMEOUT_MS = 10_000;
const RECONNECT_BASE_MS = 3_000;
const RECONNECT_MAX_MS = 60_000;
/** After this many failed “no host” probes, stop auto-retry until manual/boot. */
const MAX_NOT_FOUND_RETRIES = 3;

let port: chrome.runtime.Port | null = null;
let connecting = false;
let nativeHostInstalled = false;
/** True after a successful pong — enables disconnect→reconnect loop. */
let everConnected = false;
/** Suppress onDisconnect→scheduleReconnect during intentional teardown. */
let intentionalDisconnect = false;
let mcpSessionConnected = false;
let connectedHostName: string | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectAttempt = 0;
let notFoundStreak = 0;
let statusWaiter: {
  resolve: (v: NativeHostStatus) => void;
  timer: ReturnType<typeof setTimeout>;
} | null = null;

export type NativeHostStatus = {
  nativeHostInstalled: boolean;
  mcpConnected: boolean;
  hostName: string | null;
  hostLabel: string | null;
};

function hostLabelFor(name: string | null): string | null {
  if (!name) return null;
  return NATIVE_HOSTS.find((h) => h.name === name)?.label ?? name;
}

export function getNativeHostStatusSnapshot(): NativeHostStatus {
  return {
    nativeHostInstalled,
    mcpConnected: mcpSessionConnected,
    hostName: connectedHostName,
    hostLabel: hostLabelFor(connectedHostName),
  };
}

function clearReconnectTimer(): void {
  if (reconnectTimer != null) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
}

/**
 * Schedule a reconnect only when useful:
 *  - Host was previously connected (dropped mid-session), or
 *  - We have not yet exhausted “not found” probes after boot.
 */
function scheduleReconnect(reason?: string): void {
  clearReconnectTimer();
  const notFound = /native messaging host not found/i.test(reason ?? '');
  if (notFound) {
    nativeHostInstalled = false;
    notFoundStreak += 1;
    if (notFoundStreak > MAX_NOT_FOUND_RETRIES && !everConnected) {
      // Official: give up until next install/startup/manual reconnect.
      return;
    }
  }

  // Never thrash when we never had a host and retries are exhausted.
  if (!everConnected && notFoundStreak > MAX_NOT_FOUND_RETRIES) return;

  const delay = Math.min(
    RECONNECT_MAX_MS,
    RECONNECT_BASE_MS * Math.pow(1.5, Math.min(reconnectAttempt, 8)),
  );
  reconnectAttempt += 1;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    void tryConnectNativeHost();
  }, delay);
}

function postOutbound(msg: NativeOutbound): void {
  if (!port) return;
  try {
    port.postMessage(msg);
  } catch {
    /* port died mid-send */
  }
}

async function onHostMessage(raw: unknown): Promise<void> {
  if (!raw || typeof raw !== 'object') return;
  const msg = raw as NativeInbound;
  const type = (msg.type || '').toString();

  // Official: status_response only resolves the Options waiter with *local*
  // flags (Z/ee). The host ack does not redefine mcpConnected for us.
  if (type === 'status_response') {
    if (statusWaiter) {
      clearTimeout(statusWaiter.timer);
      const resolve = statusWaiter.resolve;
      statusWaiter = null;
      resolve(getNativeHostStatusSnapshot());
    }
    return;
  }

  const out = await handleNativeMessage(msg);
  if (out) postOutbound(out);

  // Mirror session flags when host announces MCP session state.
  if (type === 'mcp_connected') {
    mcpSessionConnected = true;
  } else if (type === 'mcp_disconnected') {
    mcpSessionConnected = false;
    // Official: detach CDP when MCP session ends so debug banner clears.
    void detachAll().catch(() => {});
  }
}

/**
 * Try Desktop then Claude Code hosts. Keeps the first port that answers pong.
 * Safe to call repeatedly — concurrent calls coalesce.
 */
export async function tryConnectNativeHost(): Promise<boolean> {
  if (port) return true;
  if (connecting) return false;
  connecting = true;
  clearReconnectTimer();

  try {
    if (typeof chrome.runtime.connectNative !== 'function') {
      nativeHostInstalled = false;
      return false;
    }

    for (const host of NATIVE_HOSTS) {
      let candidate: chrome.runtime.Port | null = null;
      try {
        candidate = chrome.runtime.connectNative(host.name);
      } catch {
        continue;
      }

      const ok = await new Promise<boolean>((resolve) => {
        let settled = false;
        const finish = (v: boolean) => {
          if (settled) return;
          settled = true;
          try {
            candidate!.onDisconnect.removeListener(onDisc);
          } catch {
            /* ignore */
          }
          try {
            candidate!.onMessage.removeListener(onMsg);
          } catch {
            /* ignore */
          }
          resolve(v);
        };
        const onDisc = () => {
          // Swallow lastError so Chrome doesn't log unhandled disconnect.
          void chrome.runtime.lastError;
          finish(false);
        };
        const onMsg = (m: { type?: string }) => {
          if (m?.type === 'pong') finish(true);
        };
        candidate!.onDisconnect.addListener(onDisc);
        candidate!.onMessage.addListener(onMsg);
        try {
          candidate!.postMessage({ type: 'ping' });
        } catch {
          finish(false);
          return;
        }
        setTimeout(() => finish(false), PING_TIMEOUT_MS);
      });

      if (!ok) {
        try {
          candidate.disconnect();
        } catch {
          /* ignore */
        }
        continue;
      }

      // Keep this port for the session.
      port = candidate;
      connectedHostName = host.name;
      nativeHostInstalled = true;
      everConnected = true;
      notFoundStreak = 0;
      reconnectAttempt = 0;

      port.onMessage.addListener((m) => {
        void onHostMessage(m);
      });
      port.onDisconnect.addListener(() => {
        const err = chrome.runtime.lastError?.message;
        port = null;
        connectedHostName = null;
        mcpSessionConnected = false;
        void setMcpConnected(false);
        if (intentionalDisconnect) {
          intentionalDisconnect = false;
          return;
        }
        // After a live connection drops, retry (host may restart).
        scheduleReconnect(err);
      });

      // Ask host for current MCP session flag (ack only — see status_response).
      try {
        port.postMessage({ type: 'get_status' });
      } catch {
        /* ignore */
      }
      return true;
    }

    nativeHostInstalled = false;
    // Soft retry a few times after boot; then wait for manual/boot probe.
    scheduleReconnect('native messaging host not found');
    return false;
  } finally {
    connecting = false;
  }
}

/** Force disconnect + clear flags (Options “reset” / tests). */
export function disconnectNativeHost(): void {
  clearReconnectTimer();
  intentionalDisconnect = true;
  const old = port;
  port = null;
  connectedHostName = null;
  mcpSessionConnected = false;
  nativeHostInstalled = false;
  // Keep everConnected so a later reconnect still uses disconnect→retry path
  // only after a successful connect; reset notFound so manual reconnect retries.
  notFoundStreak = 0;
  reconnectAttempt = 0;
  void setMcpConnected(false);
  try {
    old?.disconnect();
  } catch {
    /* ignore */
  }
  // If disconnect was sync and onDisconnect already ran, clear the flag.
  intentionalDisconnect = false;
}

/**
 * Query live status. If a port is up, re-ask the host; otherwise return snapshot.
 * Used by Options / sidepanel via runtime message.
 */
export async function checkNativeHostStatus(): Promise<NativeHostStatus> {
  if (!port || !nativeHostInstalled) {
    // Opportunistic single reconnect so Options refresh can discover a new host.
    // Reset not-found streak so user-driven refresh actually retries.
    notFoundStreak = 0;
    void tryConnectNativeHost();
    return getNativeHostStatusSnapshot();
  }

  return new Promise<NativeHostStatus>((resolve) => {
    if (statusWaiter) {
      clearTimeout(statusWaiter.timer);
      // Previous waiter gets current snapshot so it does not hang.
      statusWaiter.resolve(getNativeHostStatusSnapshot());
      statusWaiter = null;
    }
    const timer = setTimeout(() => {
      statusWaiter = null;
      resolve(getNativeHostStatusSnapshot());
    }, STATUS_TIMEOUT_MS);
    statusWaiter = { resolve, timer };
    try {
      port!.postMessage({ type: 'get_status' });
    } catch {
      clearTimeout(timer);
      statusWaiter = null;
      resolve(getNativeHostStatusSnapshot());
    }
  });
}

/**
 * Manual reconnect from Options — resets not-found streak and tries again.
 */
export async function reconnectNativeHost(): Promise<boolean> {
  disconnectNativeHost();
  notFoundStreak = 0;
  reconnectAttempt = 0;
  return tryConnectNativeHost();
}

/**
 * Official SEND_MCP_NOTIFICATION — post a notification frame to the host.
 * Returns false if no live port (caller may still fan out elsewhere).
 */
export function postMcpNotification(
  method: string,
  params?: unknown,
): boolean {
  if (!port) return false;
  try {
    port.postMessage({
      type: 'notification',
      jsonrpc: '2.0',
      method,
      params: params ?? {},
    });
    return true;
  } catch {
    return false;
  }
}

/** Boot hook: start connect loop once SW is alive. */
export function installNativeHost(): void {
  notFoundStreak = 0;
  void tryConnectNativeHost();
  // One delayed retry in case Desktop starts after the extension SW.
  setTimeout(() => {
    if (!port) void tryConnectNativeHost();
  }, 5_000);
}
