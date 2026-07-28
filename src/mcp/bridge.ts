/**
 * Official open-MCP bridge (native messaging → tool_request → execute_tool).
 *
 * Desktop / Claude Code connect via chrome.runtime.connectNative and post:
 *   { type: 'tool_request', method: 'execute_tool', params: { tool, args, … } }
 *
 * Official SW (1.0.81) calls executeTool with source:"native-messaging", then
 * posts tool_response via ie({ content, is_error }).
 *
 * We run the same tool registry the sidepanel uses. Permissions that need a
 * chat UI prompt are denied with a clear message (no sidepanel waiter in SW).
 * Skip-all permission mode still works for unattended automation.
 */

import { runTool, getTool } from '@/tools/registry';
import { permissionManager } from '@/permissions/manager';
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
 * requestPermission: auto-check only; if needsPrompt → deny (no chat UI here).
 */
function makeMcpContext(opts: {
  tabId: number;
  windowId: number;
  toolUseId: string;
  turnId: string;
  signal: AbortSignal;
}): ToolContext {
  return {
    tabId: opts.tabId,
    windowId: opts.windowId,
    turnId: opts.turnId,
    toolUseId: opts.toolUseId,
    signal: opts.signal,
    batchMode: true,
    async requestPermission(
      permission: Permission,
      detail: {
        actionLabel: string;
        url?: string;
        screenshot?: string;
        actionData?: unknown;
      },
    ) {
      await permissionManager.init();
      const url = detail.url ?? '';
      const decision = permissionManager.check(url, permission, {
        actionLabel: detail.actionLabel,
      });
      if (decision.allowed && !decision.needsPrompt) {
        return { allowed: true, needsPrompt: false };
      }
      return {
        allowed: false,
        needsPrompt: false,
        reason:
          decision.reason ??
          `Permission denied by user: "${permission}" for "${detail.actionLabel}" requires the ` +
            `side panel Allow card. Open the extension side panel, set permission ` +
            `mode to Skip (Act without asking), or pre-grant this site in Options — then retry from Desktop/MCP.`,
      };
    },
  };
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

export async function executeMcpTool(params: {
  toolName: string;
  args?: Record<string, unknown>;
  tabId?: number;
  tabGroupId?: number;
  clientId?: string;
  sessionScope?: { sessionId?: string; tabGroupId?: number; displayName?: string };
}): Promise<NativeOutbound> {
  await loadSettings();
  await permissionManager.init();

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

  const turnId = `mcp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const toolUseId = `mcp_tu_${Date.now()}`;
  const ac = new AbortController();
  await permissionManager.startTurn(turnId);

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
    const ctx = makeMcpContext({
      tabId: target.tabId,
      windowId: target.windowId,
      toolUseId,
      turnId,
      signal: ac.signal,
    });
    const args = { ...(params.args ?? {}) };
    if (args.tabId == null) args.tabId = target.tabId;

    const result = await runTool(name, args, ctx);
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
    await setMcpConnected(true);
    return null;
  }

  if (type === 'mcp_disconnected') {
    await setMcpConnected(false);
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
