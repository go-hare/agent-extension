/**
 * Open-MCP → permission UI (Claude in Chrome 1.0.81 mcpPermissions parity).
 *
 * Official path only (no sidepanel-first MCP_PERMISSION_REQUEST):
 *  1. requestId = crypto.randomUUID() (popup / storage / response key)
 *  2. chrome.storage.local mcp_prompt_${requestId}
 *  3. chrome.windows.create sidepanel?mcpPermissionOnly=true&requestId= (600×600 focused)
 *  4. wait MCP_PERMISSION_RESPONSE { requestId, allowed }  (boolean only)
 *  5. timeout 30s (3e4); cleanup storage + popup + ⌛ prefix
 *
 * Grant semantics (official SW after allow):
 *  - EZ card may show Always row disabled (disableAlwaysAllow); wire is still boolean
 *  - We resolve the MCP empty PM waiter as granted + scope **once** only
 *  - Bridge then grantOnce(toolUseId, host) [netloc ONCE] and retries the tool once
 */

import { hostOf, mcpPermissionManager } from '@/permissions/manager';
import type {
  Permission,
  PermissionDecision,
  PermissionRequest,
  PermissionScope,
} from '@/shared/types';
import { addLoadingPrefix, addPermissionPrefix } from '@/tabs/groupManager';

/** Official MCP permission popup timeout. */
const TIMEOUT_MS = 30_000;

type InflightMeta = {
  permission: Permission;
  host: string;
  timer: ReturnType<typeof setTimeout>;
  /** Chrome popup window id. */
  popupWindowId?: number;
  /** Tab that owns the 🔔 / ⌛ prefix. */
  tabId?: number;
  /** Storage key mcp_prompt_* . */
  storageKey?: string;
};

/** requestId → meta */
const inflight = new Map<string, InflightMeta>();

/**
 * If the user closes the 600×600 popup with the window chrome (X) instead of
 * Allow/Decline, finish as denied immediately — do not wait the full 30s timeout.
 * finishInflight also removes the window; onRemoved then no-ops (meta gone).
 */
let windowCloseHooked = false;
function ensurePopupCloseHook(): void {
  if (windowCloseHooked || !chrome.windows?.onRemoved) return;
  windowCloseHooked = true;
  chrome.windows.onRemoved.addListener((windowId) => {
    for (const [id, meta] of inflight) {
      if (meta.popupWindowId === windowId) {
        void finishInflight(id, false);
      }
    }
  });
}

/**
 * Response from official mcpPermissionOnly popup (and any legacy dual-shape).
 * Official: { type, requestId, allowed }
 */
export type McpPermissionResponseMsg = {
  type: 'MCP_PERMISSION_RESPONSE';
  toolUseId?: string;
  granted?: boolean;
  scope?: PermissionScope;
  requestId?: string;
  allowed?: boolean;
};

export function hasInflightMcpPermission(): boolean {
  return inflight.size > 0;
}

/** Force-deny every waiter (mcp_disconnected / intentional teardown). */
export async function abortAllMcpPermissions(): Promise<void> {
  const ids = [...inflight.keys()];
  for (const id of ids) {
    await finishInflight(id, false);
  }
}

async function finishInflight(
  id: string,
  allowed: boolean,
  scope: PermissionScope = 'once',
): Promise<boolean> {
  const meta = inflight.get(id);
  // Already finished (Allow/Decline, timeout, abort, or onRemoved after settle).
  // Do NOT re-resolve — a late windows.onRemoved after Allow would otherwise
  // race resolve(false) before/over the real answer.
  if (!meta) return false;
  clearTimeout(meta.timer);
  inflight.delete(id);

  // Resolve the waiter BEFORE tearing down the popup window. chrome.windows.remove
  // can fire onRemoved synchronously; that path must see inflight already empty
  // and no-op (above), without flipping the decision.
  // DOMAIN_TRANSITION may pass scope "always" for jZ Always continue (pair on disk).
  await mcpPermissionManager.resolve(id, allowed, scope);

  if (meta.storageKey) {
    try {
      await chrome.storage.local.remove(meta.storageKey);
    } catch {
      /* ignore */
    }
  }
  if (meta.popupWindowId != null) {
    try {
      await chrome.windows.remove(meta.popupWindowId);
    } catch {
      /* already closed */
    }
  }
  if (meta.tabId != null) {
    try {
      // Official: after respond, restore loading prefix on the MCP tab group.
      await addLoadingPrefix(meta.tabId);
    } catch {
      /* ignore */
    }
  }
  return true;
}

/** Popup answered — must run in SW so waitFor unblocks. */
export async function handleMcpPermissionResponse(
  msg: McpPermissionResponseMsg,
): Promise<boolean> {
  const id = msg.requestId || msg.toolUseId;
  if (!id) return false;
  // Official only looks at `allowed`. Fall back to `granted` for older clients.
  const allowed =
    typeof msg.allowed === 'boolean'
      ? msg.allowed
      : Boolean(msg.granted);
  // Default ONCE; DOMAIN_TRANSITION Always continue may pass scope "always".
  const scope: PermissionScope =
    msg.scope === 'always' || msg.scope === 'turn' || msg.scope === 'domain'
      ? msg.scope
      : 'once';
  return finishInflight(id, allowed, scope);
}

/**
 * Official path: storage + focused popup sidepanel.html?mcpPermissionOnly=true&requestId=
 * Returns popup window id, or null if create failed.
 */
async function openOfficialPermissionPopup(
  requestId: string,
  request: PermissionRequest,
  tabId?: number,
): Promise<number | null> {
  const storageKey = `mcp_prompt_${requestId}`;
  try {
    await chrome.storage.local.set({
      [storageKey]: {
        prompt: request,
        tabId: tabId ?? null,
        timestamp: Date.now(),
      },
    });
  } catch {
    /* storage full / denied */
  }

  if (tabId != null) {
    try {
      await addPermissionPrefix(tabId);
    } catch {
      /* ignore */
    }
  }

  return new Promise((resolve) => {
    try {
      // Official URL shape uses sidepanel.html; crxjs emits src/sidepanel/index.html.
      const url = chrome.runtime.getURL(
        `src/sidepanel/index.html?tabId=${tabId ?? ''}&mcpPermissionOnly=true&requestId=${requestId}`,
      );
      chrome.windows.create(
        {
          url,
          type: 'popup',
          width: 600,
          height: 600,
          focused: true,
        },
        (win) => {
          if (chrome.runtime.lastError || !win?.id) {
            resolve(null);
            return;
          }
          resolve(win.id);
        },
      );
    } catch {
      resolve(null);
    }
  });
}

/**
 * Official always-popup prompt, then await mcpPermissionManager.waitFor.
 * No sidepanel-first MCP_PERMISSION_REQUEST (1.0.81 has none).
 *
 * After allowed:true, caller should grantOnce(toolUseId) + retry the tool once.
 */
export async function promptMcpPermission(opts: {
  toolUseId: string;
  permission: Permission;
  detail: {
    actionLabel: string;
    url?: string;
    screenshot?: string;
    actionData?: unknown;
  };
  windowId?: number;
  tabId?: number;
  signal?: AbortSignal;
}): Promise<PermissionDecision> {
  void opts.windowId; // official popup is independent of the host window
  const url = opts.detail.url ?? '';
  const host = hostOf(url);
  const actionData = (opts.detail.actionData ?? null) as
    | { fromDomain?: string; toDomain?: string }
    | null;
  const fromDomain =
    typeof actionData?.fromDomain === 'string' ? actionData.fromDomain : '';
  const toDomain =
    typeof actionData?.toDomain === 'string' ? actionData.toDomain : host;
  // Official: crypto.randomUUID as requestId (popup/storage/response key).
  // toolUseId stays on the PermissionRequest payload for grantOnce after allow.
  const requestId =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `mcp_req_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

  const request: PermissionRequest = {
    type: 'permission_required',
    toolUseId: opts.toolUseId,
    tool: opts.permission,
    permission: opts.permission,
    url,
    host,
    actionLabel: opts.detail.actionLabel,
    screenshot: opts.detail.screenshot,
    actionData: opts.detail.actionData,
  };

  // Register waiter FIRST so a fast popup response cannot race past waitFor.
  // DOMAIN_TRANSITION needs from/to so Stop sticks as a pair deny (not host:perm).
  const waitPromise = mcpPermissionManager.waitFor(
    requestId,
    opts.permission,
    host,
    { fromDomain, toDomain },
  );

  const timer = setTimeout(() => {
    void finishInflight(requestId, false);
  }, TIMEOUT_MS);

  inflight.set(requestId, {
    permission: opts.permission,
    host,
    timer,
    tabId: opts.tabId,
    storageKey: `mcp_prompt_${requestId}`,
  });

  const onAbort = () => {
    void finishInflight(requestId, false);
  };
  opts.signal?.addEventListener('abort', onAbort, { once: true });

  ensurePopupCloseHook();
  const popupId = await openOfficialPermissionPopup(requestId, request, opts.tabId);
  const meta = inflight.get(requestId);
  if (meta) {
    meta.popupWindowId = popupId ?? undefined;
  }

  if (popupId == null) {
    // Official: windows.create failure → resolve(false) immediately.
    opts.signal?.removeEventListener('abort', onAbort);
    await finishInflight(requestId, false);
    await waitPromise.catch(() => {});
    return {
      allowed: false,
      needsPrompt: false,
      reason:
        `Permission required for "${opts.detail.actionLabel}"` +
        `${host ? ` on ${host}` : ''}, but the permission popup could not be opened. ` +
        `Check that popups are not blocked for this extension, then retry from Desktop / Claude Code.`,
    };
  }

  const answer = await waitPromise;
  opts.signal?.removeEventListener('abort', onAbort);

  // Cleanup residual meta if resolve path skipped finishInflight (shouldn't).
  const leftover = inflight.get(requestId);
  if (leftover) {
    clearTimeout(leftover.timer);
    inflight.delete(requestId);
    if (leftover.storageKey) {
      try {
        await chrome.storage.local.remove(leftover.storageKey);
      } catch {
        /* ignore */
      }
    }
    if (leftover.popupWindowId != null) {
      try {
        await chrome.windows.remove(leftover.popupWindowId);
      } catch {
        /* ignore */
      }
    }
  }

  // Stash scope on the decision so bridge can permanent-grant DOMAIN_TRANSITION Always.
  if (!answer.granted) {
    if (opts.signal?.aborted) {
      return {
        allowed: false,
        needsPrompt: false,
        reason: `Permission wait aborted for "${opts.detail.actionLabel}".`,
      };
    }
    return {
      allowed: false,
      needsPrompt: false,
      reason:
        `Permission denied by user: "${opts.permission}" for "${opts.detail.actionLabel}"` +
        `${host ? ` on ${host}` : ''}.`,
    };
  }

  return {
    allowed: true,
    needsPrompt: false,
    scope: answer.scope ?? 'once',
  };
}
