/**
 * Official open-MCP bridge (native messaging → tool_request → execute_tool).
 *
 * Desktop / Claude Code connect via chrome.runtime.connectNative and post:
 *   { type: 'tool_request', method: 'execute_tool', params: { tool, args, … } }
 *
 * Official SW (1.0.81):
 *  - empty permissionManager `new WN(() => !1, {})` (no chat always/skip)
 *  - tool returns permission_required → popup → allowed boolean
 *  - grantPermission ONCE for toolUseId → retry handleToolCall once
 *
 * Nested `browser_batch` still fast-fails steps that need a fresh grant.
 */

import { runTool, getTool } from '@/tools/registry';
import {
  hostOf,
  mcpPermissionManager,
} from '@/permissions/manager';
import { loadSettings } from '@/storage/settings';
import type { Permission, ToolContext, ToolResult } from '@/shared/types';
import { showIndicator, hideIndicator } from '@/tools/tabs';
import {
  createMcpTab,
  closeMcpTab,
  formatMcpTabsList,
  getOrCreateMcpTabContext,
  getOrCreateSessionTabContext,
  setMcpConnected,
} from './group';
import {
  startMcpTabGroupListener,
  stopMcpTabGroupListener,
} from './tabGroupListener';
import {
  abortAllMcpPermissions,
  promptMcpPermission,
} from './permissionBridge';

/** One permission turn for the whole MCP native session (not per tool_request). */
const MCP_SESSION_TURN_ID = 'mcp_session';
let mcpSessionTurnReady = false;

async function ensureMcpSessionTurn(): Promise<void> {
  if (mcpSessionTurnReady) {
    // Re-load deny/allow lists without clearing ONCE map mid-session.
    await mcpPermissionManager.init();
    return;
  }
  await mcpPermissionManager.startTurn(MCP_SESSION_TURN_ID);
  mcpSessionTurnReady = true;
}

function resetMcpSessionTurn(): void {
  mcpSessionTurnReady = false;
  mcpPermissionManager.clearOnceGrants();
}

/**
 * Tools Desktop / Claude Code may invoke over the bridge.
 * Matches official `de` allowlist in service-worker (1.0.81).
 */
export const MCP_BRIDGE_TOOLS = new Set([
  'javascript_tool',
  'read_page',
  'find',
  'form_input',
  'computer',
  'browser_batch',
  'navigate',
  'resize_window',
  'gif_creator',
  'upload_image',
  'get_page_text',
  'tabs_context_mcp',
  'tabs_create_mcp',
  'tabs_close_mcp',
  'read_console_messages',
  'read_network_requests',
]);

export type NativeInbound =
  | { type: 'ping' | 'PING' }
  | { type: 'get_status' | 'status' | 'STATUS' }
  | { type: 'mcp_connected' }
  | { type: 'mcp_disconnected' }
  | {
      type: 'tool_request';
      method?: string;
      params?: {
        tool?: string;
        args?: Record<string, unknown>;
        client_id?: string;
        tabGroupId?: number | string;
        tabId?: number | string;
        session_scope?: {
          sessionId?: string;
          tabGroupId?: number;
          displayName?: string;
        };
      };
    }
  | { type: string; [k: string]: unknown };

export type NativeOutbound =
  | { type: 'pong'; ok: true }
  | {
      type: 'status_response';
      nativeHostInstalled: true;
      mcpConnected: boolean;
    }
  | {
      type: 'tool_response';
      result?: { content: string | Array<{ type: string; text?: string }> };
      error?: { content: string | Array<{ type: string; text?: string }> };
    }
  | {
      type: 'pairing_response';
      request_id: string;
      device_id?: string;
      name?: string;
      dismissed?: boolean;
    };

const STICKY_DENY_SUFFIX =
  'IMPORTANT: The user has explicitly declined this action. ' +
  'Do not attempt to use other tools or workarounds. Instead, acknowledge ' +
  'the denial and ask the user how they would prefer to proceed.';

function asNumber(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() && Number.isFinite(Number(v))) {
    return Number(v);
  }
  return undefined;
}

/**
 * Official extracts tabId from params.args.tabId, or from the first
 * browser_batch action that carries input.tabId.
 */
function extractTabId(
  toolName: string,
  args: Record<string, unknown> | undefined,
  topLevel?: unknown,
): number | undefined {
  const fromTop = asNumber(topLevel);
  if (fromTop != null) return fromTop;
  const fromArgs = asNumber(args?.tabId);
  if (fromArgs != null) return fromArgs;
  if (toolName === 'browser_batch' && Array.isArray(args?.actions)) {
    for (const action of args.actions) {
      if (!action || typeof action !== 'object') continue;
      const input = (action as { input?: { tabId?: unknown } }).input;
      const id = asNumber(input?.tabId);
      if (id != null) return id;
    }
  }
  return undefined;
}

/** Text-only fallback (errors / no images). */
function formatResultText(r: ToolResult): string {
  if (r.error) return r.error;
  return r.output?.trim() || 'ok';
}

/**
 * Official ie({ content, is_error }) shape: text + image content blocks so
 * Desktop / Claude Code can see computer.screenshot pixels.
 */
function formatResultContent(
  r: ToolResult,
): string | Array<{ type: string; text?: string; source?: Record<string, string> }> {
  if (r.error) return r.error;
  const blocks: Array<{ type: string; text?: string; source?: Record<string, string> }> = [];
  if (r.output?.trim()) {
    blocks.push({ type: 'text', text: r.output });
  }
  for (const img of r.images ?? []) {
    blocks.push({
      type: 'image',
      source: {
        type: 'base64',
        media_type: img.mediaType,
        data: img.data,
      },
    });
  }
  if (blocks.length === 0) return 'ok';
  if (blocks.length === 1 && blocks[0]!.type === 'text') return blocks[0]!.text || 'ok';
  return blocks;
}

/** Official sticky-deny wording only when the string already says permission denied. */
function toolErrorContent(msg: string): NativeOutbound {
  const content =
    msg.includes('Permission denied by user') &&
    !msg.includes('IMPORTANT: The user has explicitly declined')
      ? `${msg} - ${STICKY_DENY_SUFFIX}`
      : msg;
  return {
    type: 'tool_response',
    error: { content },
  };
}

function toolOkContent(msg: string): NativeOutbound {
  return {
    type: 'tool_response',
    result: { content: msg },
  };
}

/**
 * Build a ToolContext for SW-side MCP runs.
 *
 * Official shape:
 *  - empty/isolated mcpPermissionManager (no chat always/skip)
 *  - check with toolUseId so ONCE grants apply on retry
 *  - needsPrompt → return decision (guard emits permissionRequired)
 *  - bridge prompts + grantOnce + retries once
 * Nested browser_batch still sets batchMode:true and fast-fails fresh prompts.
 */
function makeMcpContext(opts: {
  tabId: number;
  windowId: number;
  toolUseId: string;
  turnId: string;
  signal: AbortSignal;
}): ToolContext {
  const ctx: ToolContext = {
    tabId: opts.tabId,
    windowId: opts.windowId,
    turnId: opts.turnId,
    toolUseId: opts.toolUseId,
    signal: opts.signal,
    batchMode: false,
    // Official native-messaging path has no follow_a_plan gate.
    skipPlanGate: true,
    // Official: tools surface permission_required; bridge retries after grant.
    mcpPermissionRequired: true,

    async requestPermission(
      this: ToolContext,
      permission: Permission,
      detail: {
        actionLabel: string;
        url?: string;
        screenshot?: string;
        actionData?: unknown;
      },
    ) {
      await mcpPermissionManager.init();
      const url = detail.url ?? '';
      const decision = mcpPermissionManager.check(url, permission, {
        actionLabel: detail.actionLabel,
        toolUseId: opts.toolUseId,
      });

      if (decision.allowed) return decision;
      if (!decision.needsPrompt) return decision;

      // Match chat loop: batch nested steps must not hang on UI.
      if (this.batchMode) {
        return {
          allowed: false,
          needsPrompt: true,
          reason:
            `Permission required for "${detail.actionLabel}"` +
            `${url ? ` (${url})` : ''}. Call this tool standalone (not inside ` +
            `browser_batch) so the permission popup can Allow it, then retry the batch.`,
        };
      }

      // Surface permission_required to the bridge (do not wait here).
      return {
        allowed: false,
        needsPrompt: true,
        reason: decision.reason,
      };
    },
  };
  return ctx;
}

/**
 * Resolve which tab an MCP tool should run against.
 * Prefer session group when session_scope is present; else shared Claude (MCP).
 */
async function resolveTargetTab(params: {
  tabId?: number;
  tabGroupId?: number;
  toolName: string;
  sessionScope?: { sessionId?: string; tabGroupId?: number; displayName?: string };
}): Promise<{ tabId: number; windowId: number; tabGroupId?: number }> {
  const hasSession = Boolean(params.sessionScope);
  const createIfEmpty =
    params.toolName.startsWith('tabs_') || params.toolName === 'navigate';

  let mcpCtx = null as Awaited<ReturnType<typeof getOrCreateMcpTabContext>>;
  if (hasSession) {
    mcpCtx = await getOrCreateSessionTabContext(
      params.tabGroupId ?? params.sessionScope?.tabGroupId,
      {
        createIfEmpty,
        displayName: params.sessionScope?.displayName,
      },
    );
  } else {
    mcpCtx = await getOrCreateMcpTabContext({ createIfEmpty });
  }

  if (params.tabId != null) {
    try {
      const t = await chrome.tabs.get(params.tabId);
      if (t.id != null) {
        if (mcpCtx && t.groupId !== mcpCtx.tabGroupId) {
          throw new Error(
            `Tab ${params.tabId} is outside the Claude (MCP) tab group. ` +
              `Call tabs_context_mcp for valid tab IDs, or use tabs_create_mcp.`,
          );
        }
        return {
          tabId: t.id,
          windowId: t.windowId,
          tabGroupId: mcpCtx?.tabGroupId ?? params.tabGroupId,
        };
      }
    } catch (e) {
      if (
        e instanceof Error &&
        /outside the Claude \(MCP\)|no longer exists/i.test(e.message)
      ) {
        throw e;
      }
    }
  }

  if (mcpCtx && mcpCtx.tabs.length > 0) {
    const active = mcpCtx.tabs.find((t) => t.active) ?? mcpCtx.tabs[0]!;
    return {
      tabId: active.id,
      windowId: mcpCtx.windowId,
      tabGroupId: mcpCtx.tabGroupId,
    };
  }

  throw new Error(
    'No MCP tab available. Call tabs_context_mcp with createIfEmpty: true first.',
  );
}

/**
 * Serialize MCP tool_requests (official also fires async; concurrent CDP
 * attaches on the same tab race). One-at-a-time keeps debugger + indicators stable.
 */
let mcpToolChain: Promise<void> = Promise.resolve();
/** In-flight MCP tool executions (for sidepanel-disconnect detach policy). */
let activeMcpTools = 0;

export function hasActiveMcpTool(): boolean {
  return activeMcpTools > 0;
}

function enqueueMcpTool<T>(fn: () => Promise<T>): Promise<T> {
  const run = mcpToolChain.then(
    async () => {
      activeMcpTools += 1;
      try {
        return await fn();
      } finally {
        activeMcpTools = Math.max(0, activeMcpTools - 1);
      }
    },
    async () => {
      activeMcpTools += 1;
      try {
        return await fn();
      } finally {
        activeMcpTools = Math.max(0, activeMcpTools - 1);
      }
    },
  );
  mcpToolChain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

export async function executeMcpTool(params: {
  toolName: string;
  args?: Record<string, unknown>;
  tabId?: number;
  tabGroupId?: number;
  clientId?: string;
  sessionScope?: { sessionId?: string; tabGroupId?: number; displayName?: string };
}): Promise<NativeOutbound> {
  return enqueueMcpTool(() => executeMcpToolInner(params));
}

async function executeMcpToolInner(params: {
  toolName: string;
  args?: Record<string, unknown>;
  tabId?: number;
  tabGroupId?: number;
  clientId?: string;
  sessionScope?: { sessionId?: string; tabGroupId?: number; displayName?: string };
}): Promise<NativeOutbound> {
  await loadSettings();
  // MCP uses isolated empty PM only (never chat permissionManager).
  await mcpPermissionManager.init();

  const name = params.toolName;

  if (!MCP_BRIDGE_TOOLS.has(name)) {
    return toolErrorContent(`Tool "${name}" is not available on the MCP bridge.`);
  }

  // ─── tabs_context_mcp ───
  if (name === 'tabs_context_mcp') {
    try {
      const createIfEmpty = Boolean(params.args?.createIfEmpty);
      if (params.sessionScope) {
        const ctx = await getOrCreateSessionTabContext(
          params.tabGroupId ?? params.sessionScope.tabGroupId,
          {
            createIfEmpty,
            displayName: params.sessionScope.displayName,
          },
        );
        if (!ctx) {
          return toolOkContent(
            'No tab group exists for this session. Use createIfEmpty: true to create one.',
          );
        }
        const current =
          params.tabId != null && ctx.tabs.some((t) => t.id === params.tabId)
            ? params.tabId
            : ctx.currentTabId;
        return toolOkContent(
          formatMcpTabsList(ctx.tabs, ctx.tabGroupId, current),
        );
      }

      const ctx = await getOrCreateMcpTabContext({ createIfEmpty });
      if (!ctx) {
        return toolOkContent(
          'No MCP tab groups found. Use createIfEmpty: true to create one.',
        );
      }
      const current =
        params.tabId != null && ctx.tabs.some((t) => t.id === params.tabId)
          ? params.tabId
          : ctx.currentTabId;
      const header = ctx.created ? ` [created]` : '';
      return toolOkContent(
        formatMcpTabsList(ctx.tabs, ctx.tabGroupId, current).replace(
          `MCP tab group ${ctx.tabGroupId}`,
          `MCP tab group ${ctx.tabGroupId}${header}`,
        ),
      );
    } catch (e) {
      return toolErrorContent(
        `Failed to query tabs: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  // ─── tabs_create_mcp ───
  if (name === 'tabs_create_mcp') {
    try {
      const sessionGid = params.sessionScope
        ? params.tabGroupId ?? params.sessionScope.tabGroupId
        : undefined;
      if (params.sessionScope && sessionGid == null) {
        return toolErrorContent(
          'No tab group exists for this session yet. Call tabs_context_mcp with createIfEmpty: true first — that creates this session\'s group and returns its tab IDs.',
        );
      }
      const r = await createMcpTab(
        sessionGid ??
          (params.sessionScope ? undefined : params.tabGroupId),
      );
      // When session-scoped without explicit id, createMcpTab uses shared group —
      // for session with id we already passed it.
      const gid =
        sessionGid ??
        params.tabGroupId ??
        r.tabGroupId;
      return toolOkContent(
        `Created new tab. Tab ID: ${r.tabId}` +
          (gid != null ? ` (group ${gid})` : ''),
      );
    } catch (e) {
      return toolErrorContent(
        e instanceof Error ? e.message : `Failed to create tab: ${String(e)}`,
      );
    }
  }

  // ─── tabs_close_mcp ───
  if (name === 'tabs_close_mcp') {
    try {
      const tabId = asNumber(params.args?.tabId) ?? params.tabId;
      if (tabId == null) {
        return toolErrorContent('tabs_close_mcp requires tabId.');
      }
      await closeMcpTab(
        tabId,
        params.sessionScope
          ? params.tabGroupId ?? params.sessionScope.tabGroupId
          : undefined,
      );
      return toolOkContent(`Closed MCP tab ${tabId}.`);
    } catch (e) {
      return toolErrorContent(e instanceof Error ? e.message : String(e));
    }
  }

  if (!getTool(name)) {
    return toolErrorContent(`Unknown tool "${name}".`);
  }

  let target: { tabId: number; windowId: number; tabGroupId?: number };
  try {
    target = await resolveTargetTab({
      tabId: params.tabId,
      tabGroupId: params.tabGroupId ?? params.sessionScope?.tabGroupId,
      toolName: name,
      sessionScope: params.sessionScope,
    });
  } catch (e) {
    return toolErrorContent(e instanceof Error ? e.message : String(e));
  }

  // Official empty MCP PM session + per-toolUseId ONCE grants for retry.
  const turnId = MCP_SESSION_TURN_ID;
  const toolUseId = `mcp_tu_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const ac = new AbortController();
  await ensureMcpSessionTurn();

  // Official: MCP sessions pass isMcp so Stop pill is suppressed.
  const interactive = ![
    'read_console_messages',
    'read_network_requests',
    'get_page_text',
    'read_page',
    'find',
  ].includes(name);
  if (interactive) {
    void showIndicator(target.tabId, undefined, { isMcp: true });
  }

  try {
    const args = { ...(params.args ?? {}) };
    if (args.tabId == null) args.tabId = target.tabId;

    const runOnce = () =>
      runTool(
        name,
        args,
        makeMcpContext({
          tabId: target.tabId,
          windowId: target.windowId,
          toolUseId,
          turnId,
          signal: ac.signal,
        }),
      );

    // ── first execute (official handleToolCall) ──
    let result = await runOnce();

    // Official: permission_required → onPermissionRequired(popup) →
    // grantPermission(ONCE, toolUseId) → retry handleToolCall exactly once.
    // If still permission_required after grant → hard error (no second popup).
    if (result.permissionRequired && !result.error) {
      const pr = result.permissionRequired;
      if (ac.signal.aborted) {
        return toolErrorContent('Permission wait aborted.');
      }

      const decision = await promptMcpPermission({
        toolUseId,
        permission: pr.permission,
        detail: {
          actionLabel: pr.actionLabel,
          url: pr.url,
          screenshot: pr.screenshot,
          actionData: pr.actionData,
        },
        windowId: target.windowId,
        tabId: target.tabId,
        signal: ac.signal,
      });

      if (!decision.allowed) {
        // Official: error "Permission denied by user" (+ sticky suffix in tool_response).
        return toolErrorContent('Permission denied by user');
      }

      // Official: grantPermission({type:"netloc", netloc:host}, qI.ONCE, toolUseId, origin)
      // ONCE is host-scoped only — no permission type on the grant.
      const h = hostOf(pr.url);
      if (h) {
        mcpPermissionManager.grantOnce(toolUseId, h, pr.permission);
      }

      // ── retry_execute (official second handleToolCall) ──
      result = await runOnce();

      if (result.permissionRequired) {
        // Official throws: "Permission still required after granting"
        return toolErrorContent('Permission still required after granting');
      }
    }

    // Defensive: bare permissionRequired without error must not look like success.
    if (result.permissionRequired && !result.error) {
      return toolErrorContent(
        `Permission required for "${result.permissionRequired.actionLabel}" was not resolved.`,
      );
    }

    if (result.error) {
      return toolErrorContent(formatResultText(result));
    }
    return {
      type: 'tool_response',
      result: { content: formatResultContent(result) },
    };
  } catch (e) {
    return toolErrorContent(
      `Tool execution failed: ${e instanceof Error ? e.message : String(e)}`,
    );
  } finally {
    mcpPermissionManager.clearOnceGrants(toolUseId);
    if (interactive) {
      void hideIndicator(target.tabId).catch(() => {});
    }
  }
}

export async function handleNativeMessage(
  msg: NativeInbound,
): Promise<NativeOutbound | null> {
  const type = (msg?.type || '').toString();

  if (type === 'ping' || type === 'PING') {
    return { type: 'pong', ok: true };
  }

  if (type === 'get_status' || type === 'status' || type === 'STATUS') {
    const connected = await isMcpConnectedFlag();
    return {
      type: 'status_response',
      nativeHostInstalled: true,
      mcpConnected: connected,
    };
  }

  if (type === 'mcp_connected') {
    // Official: set flag + initialize group manager + startTabGroupChangeListener.
    // Do NOT createIfEmpty here — Desktop creates groups via tabs_context_mcp.
    await setMcpConnected(true);
    resetMcpSessionTurn();
    await ensureMcpSessionTurn();
    startMcpTabGroupListener();
    return null;
  }

  if (type === 'mcp_disconnected') {
    await setMcpConnected(false);
    stopMcpTabGroupListener();
    await abortAllMcpPermissions();
    resetMcpSessionTurn();
    return null;
  }

  if (type === 'tool_request') {
    const m = msg as Extract<NativeInbound, { type: 'tool_request' }>;
    const method = m.method || 'execute_tool';
    if (method !== 'execute_tool') {
      return toolErrorContent(`Unknown method: ${method}`);
    }
    const p = m.params || {};
    if (!p.tool) {
      return toolErrorContent('No tool specified');
    }
    const args = p.args || {};
    // Official primarily reads tabGroupId / tabId from args.
    return executeMcpTool({
      toolName: p.tool,
      args,
      tabId: extractTabId(p.tool, args, p.tabId),
      tabGroupId:
        asNumber(args.tabGroupId) ??
        asNumber(p.tabGroupId) ??
        asNumber(p.session_scope?.tabGroupId),
      clientId: p.client_id,
      sessionScope: p.session_scope,
    });
  }

  return null;
}

async function isMcpConnectedFlag(): Promise<boolean> {
  try {
    const raw = await chrome.storage.local.get('mcpConnected');
    return raw.mcpConnected === true;
  } catch {
    return false;
  }
}

export { setMcpConnected, isMcpConnected } from './group';
