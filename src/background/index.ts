/**
 * Service worker.
 *
 * 有意做得**很薄**。agent loop 和工具都在侧栏里跑（见 sidepanel/agent/loop.ts
 * 的架构说明），SW 只负责这些活不下去就没人干的事：
 *
 *  - 侧栏的开关和 action 点击（必须在 SW 里注册）
 *  - CDP 会话的全局回收（侧栏关了/崩了要有人 detach）
 *  - 设置缓存的预热
 *
 * SW 随时会被 Chrome 杀掉再重启，所以这里**不持有任何重要状态**，
 * 需要跨重启的东西一律进 chrome.storage.session。
 */

import { installCdpListeners, reclaimStaleSessions, detachAll } from '@/cdp/session';
import { hasUsableCredentials, loadSettings, peekSettings, watchSettings } from '@/storage/settings';
import {
  ALARM_PREFIX,
  enqueuePrompt,
  getScheduleByAlarmName,
  rescheduleAfterFire,
  resyncAllAlarms,
  type Schedule,
} from '@/scheduling/store';
import {
  checkNativeHostStatus,
  completePairingConfirm,
  completePairingDismiss,
  getNativeHostStatusSnapshot,
  installNativeHost,
  postMcpNotification,
  reconnectNativeHost,
  tryConnectNativeHost,
} from '@/mcp/nativeHost';
import { hasActiveMcpTool } from '@/mcp/bridge';
import {
  handleMcpPermissionResponse,
  hasInflightMcpPermission,
  type McpPermissionResponseMsg,
} from '@/mcp/permissionBridge';
import type { PermissionScope } from '@/shared/types';
import { ensureOffscreenDocument } from '@/offscreen/ensure';

// ───────────────────────── 侧栏开关 ─────────────────────────

/**
 * 让点击工具栏图标直接开侧栏。
 *
 * 这是**唯一可靠**的开法：Chrome 自己处理手势链，我们不需要在
 * action.onClicked 里同步调 sidePanel.open()（那个一旦 await 过任何东西
 * 就会因为丢失用户手势而失败）。
 */
chrome.runtime.onInstalled.addListener(async () => {
  try {
    await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  } catch {
    /* 老版本 Chrome 没有这个 API */
  }
  await loadSettings();
  // Official: probe Desktop / Claude Code native hosts after install/update.
  void tryConnectNativeHost();
});

chrome.runtime.onStartup.addListener(async () => {
  await loadSettings();
  await reclaimStaleSessions();
  void tryConnectNativeHost();
});

/**
 * 键盘快捷键开侧栏。
 *
 * commands 回调**是**用户手势，可以同步调 open()。
 * 注意不能 await 任何东西再调 —— 所以这里先同步 open，再做别的。
 */
chrome.commands.onCommand.addListener((command, tab) => {
  if (command !== 'toggle-side-panel') return;
  const windowId = tab?.windowId;
  if (windowId === undefined) return;

  // 同步调用，保住手势
  void chrome.sidePanel.open({ windowId }).catch(() => {
    /* 已经开着时会 reject，忽略 */
  });
});

// ───────────────────────── 未配置引导 ─────────────────────────

/**
 * 没配 API Key 时，把用户送到配置页。
 *
 * 用 peekSettings（同步缓存）而不是 await loadSettings()：
 * onClicked 回调里一旦 await，手势就没了。
 *
 * 注意：这里**不**用 action.onClicked 抢侧栏的打开逻辑
 * （setPanelBehavior 已经接管了）。onClicked 在 setPanelBehavior 生效时
 * 根本不会触发，所以这段只在极老的 Chrome 上作为兜底。
 */
chrome.action.onClicked.addListener((tab) => {
  if (!hasUsableCredentials(peekSettings())) {
    void chrome.runtime.openOptionsPage();
    return;
  }
  if (tab?.windowId !== undefined) {
    void chrome.sidePanel.open({ windowId: tab.windowId }).catch(() => {});
  }
});

// ───────────────────────── CDP 生命周期 ─────────────────────────

installCdpListeners();

/**
 * 侧栏断开 = 聊天任务结束 = 通常必须 detach。
 *
 * 不 detach 的话，页面顶部的"XX 正在调试此浏览器"横幅会一直挂着，
 * 用户会以为扩展还在偷偷操作。
 *
 * 例外：Open-MCP 工具在 SW 里跑，侧栏关掉不能拆掉 MCP 正在用的 debugger；
 * 等 MCP 会话结束 / 权限超时后再由 bridge / nativeHost 清理。
 *
 * 同时计数 sidepanel port，供定时任务决定是入队还是只发通知。
 */
let sidepanelPorts = 0;

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'sidepanel') return;
  sidepanelPorts += 1;
  port.onDisconnect.addListener(() => {
    sidepanelPorts = Math.max(0, sidepanelPorts - 1);
    if (sidepanelPorts > 0) return;
    // Keep CDP while an MCP tool (or its Allow card) is in flight in the SW.
    // Idle MCP host connection alone does not block detach — chat banners clear.
    if (hasInflightMcpPermission() || hasActiveMcpTool()) return;
    void detachAll();
  });
});
// ───────────────────────── 消息 ─────────────────────────

type Msg =
  | { type: 'OPEN_OPTIONS' }
  | { type: 'PLAY_NOTIFICATION_SOUND'; volume?: number }
  | { type: 'SHOW_NOTIFICATION'; title: string; message: string }
  | { type: 'RESIZE_WINDOW'; windowId: number; width: number; height: number }
  // Official open MCP status (Desktop / Claude Code native host)
  // snake_case = official message names; SCREAMING = our Options aliases
  | { type: 'CHECK_NATIVE_HOST_STATUS' | 'check_native_host_status' }
  | { type: 'RECONNECT_NATIVE_HOST' | 'reconnect_native_host' }
  | { type: 'SEND_MCP_NOTIFICATION'; method?: string; params?: unknown }
  // Official pairing.html / sidepanel PairingPrompt
  | { type: 'pairing_confirmed'; request_id?: string; name?: string }
  | { type: 'pairing_dismissed'; request_id?: string }
  | { type: 'show_pairing_prompt'; request_id?: string; client_type?: string; current_name?: string }
  // Open-MCP → mcpPermissionOnly popup (official boolean response)
  | {
      type: 'MCP_PERMISSION_RESPONSE';
      toolUseId?: string;
      granted?: boolean;
      scope?: PermissionScope;
      requestId?: string;
      allowed?: boolean;
    }
  // Offscreen keepalive (official SW_KEEPALIVE)
  | { type: 'SW_KEEPALIVE' }
  // Teach Claude ephemeral inject messages; SW ignores so sidepanel receives them.
  | { type: 'ELEMENT_SELECTION' }
  | { type: 'KEYSTROKE_UPDATE' }
  | { type: 'CANCEL_ELEMENT_SELECTOR' }
  | { type: 'WORKFLOW_STEP'; step?: unknown }
  // Official agent-visual-indicator → sidepanel
  | { type: 'STOP_AGENT'; fromTabId?: string | number }
  | { type: 'STATIC_INDICATOR_HEARTBEAT' }
  | { type: 'SWITCH_TO_MAIN_TAB' }
  | { type: 'DISMISS_STATIC_INDICATOR_FOR_GROUP' };

chrome.runtime.onMessage.addListener((msg: Msg, sender, sendResponse) => {
  switch (msg?.type) {
    case 'OPEN_OPTIONS':
      void chrome.runtime.openOptionsPage();
      sendResponse({ ok: true });
      return false;

    case 'SW_KEEPALIVE':
      // Touch from offscreen doc — keeps this SW event loop warm.
      sendResponse({ ok: true });
      return false;

    case 'PLAY_NOTIFICATION_SOUND': {
      const volume = msg.volume ?? 0.5;
      void (async () => {
        try {
          await ensureOffscreenDocument();
          const audioUrl = chrome.runtime.getURL('public/sounds/notification.mp3');
          const res = await chrome.runtime.sendMessage({
            type: 'OFFSCREEN_PLAY_SOUND',
            audioUrl,
            volume,
          });
          sendResponse(res ?? { success: true });
        } catch (e) {
          sendResponse({
            success: false,
            error: e instanceof Error ? e.message : String(e),
          });
        }
      })();
      return true;
    }

    case 'SHOW_NOTIFICATION':
      void chrome.notifications.create({
        type: 'basic',
        iconUrl: chrome.runtime.getURL('public/icons/icon-128.png'),
        title: msg.title,
        message: msg.message,
      });
      // SW cannot receive its own runtime.sendMessage — play via offscreen
      // directly (same path as PLAY_NOTIFICATION_SOUND).
      void (async () => {
        try {
          await ensureOffscreenDocument();
          const audioUrl = chrome.runtime.getURL('public/sounds/notification.mp3');
          await chrome.runtime.sendMessage({
            type: 'OFFSCREEN_PLAY_SOUND',
            audioUrl,
            volume: 0.5,
          });
        } catch {
          /* best-effort */
        }
      })();
      sendResponse({ ok: true });
      return false;

    case 'pairing_confirmed': {
      const requestId = msg.request_id;
      const name = msg.name;
      if (requestId && name) {
        void completePairingConfirm(requestId, name).then(() =>
          sendResponse({ ok: true }),
        );
        return true;
      }
      sendResponse({ ok: false, error: 'missing request_id or name' });
      return false;
    }

    case 'pairing_dismissed': {
      const requestId = msg.request_id;
      if (requestId) completePairingDismiss(requestId);
      sendResponse({ ok: true });
      return false;
    }

    case 'show_pairing_prompt':
      // Sidepanel owns the in-panel PairingPrompt and must be the only
      // responder ({ handled: true }). If we answer here, we steal the
      // response and nativeHost never falls through to pairing.html.
      return false;

    case 'MCP_PERMISSION_RESPONSE': {
      const m = msg as McpPermissionResponseMsg;
      if (!m.toolUseId && !m.requestId) {
        sendResponse({ ok: false, error: 'missing toolUseId/requestId' });
        return false;
      }
      void handleMcpPermissionResponse(m).then(
        (ok) => sendResponse({ ok }),
        (e: unknown) =>
          sendResponse({
            ok: false,
            error: e instanceof Error ? e.message : String(e),
          }),
      );
      return true;
    }

    case 'RESIZE_WINDOW':
      void chrome.windows
        .update(msg.windowId, { width: msg.width, height: msg.height, state: 'normal' })
        .then(() => sendResponse({ ok: true }))
        .catch((e: unknown) =>
          sendResponse({ ok: false, error: e instanceof Error ? e.message : String(e) }),
        );
      return true; // 异步回复

    // Official check_native_host_status — Options / ProductExplainer / host UI.
    case 'CHECK_NATIVE_HOST_STATUS':
    case 'check_native_host_status':
      void checkNativeHostStatus()
        .then((status) =>
          // Official shape: { status: { nativeHostInstalled, mcpConnected } }
          sendResponse({
            ok: true,
            status: {
              nativeHostInstalled: status.nativeHostInstalled,
              mcpConnected: status.mcpConnected,
              hostName: status.hostName,
              hostLabel: status.hostLabel,
            },
          }),
        )
        .catch((e: unknown) =>
          sendResponse({
            ok: false,
            error: e instanceof Error ? e.message : String(e),
          }),
        );
      return true;

    case 'RECONNECT_NATIVE_HOST':
    case 'reconnect_native_host':
      // Full reset + probe (Options button / clau.de reconnect equivalent).
      void reconnectNativeHost()
        .then((connected) => {
          const snap = getNativeHostStatusSnapshot();
          sendResponse({
            ok: true,
            connected,
            status: {
              nativeHostInstalled: snap.nativeHostInstalled,
              mcpConnected: snap.mcpConnected,
              hostName: snap.hostName,
              hostLabel: snap.hostLabel,
            },
          });
        })
        .catch((e: unknown) =>
          sendResponse({
            ok: false,
            error: e instanceof Error ? e.message : String(e),
          }),
        );
      return true;

    // Official SEND_MCP_NOTIFICATION — forward JSON-RPC-ish notify to host if live.
    case 'SEND_MCP_NOTIFICATION': {
      const method = (msg as { method?: string }).method;
      const params = (msg as { params?: unknown }).params;
      void (async () => {
        try {
          await tryConnectNativeHost();
          const ok = postMcpNotification(
            method || 'notifications/message',
            params,
          );
          sendResponse({
            success: ok,
            status: getNativeHostStatusSnapshot(),
          });
        } catch {
          sendResponse({ success: false });
        }
      })();
      return true;
    }

    // Page "Stop Claude" pill → broadcast so the open sidepanel aborts the turn.
    case 'STOP_AGENT':
      void chrome.runtime.sendMessage({ type: 'STOP_AGENT_REQUEST' }).catch(() => {
        /* no sidepanel listening */
      });
      // Also detach debugger so the banner clears immediately.
      void detachAll();
      sendResponse({ ok: true });
      return false;

    // Static group indicator heartbeat — alive while a sidepanel port is open.
    case 'STATIC_INDICATOR_HEARTBEAT':
      sendResponse({ success: sidepanelPorts > 0 });
      return false;

    case 'SWITCH_TO_MAIN_TAB':
    case 'DISMISS_STATIC_INDICATOR_FOR_GROUP':
      // Handled lightly; full group meta lives in sidepanel storage.
      sendResponse({ ok: true });
      return false;

    // Teach Claude: sidepanel owns recording; SW just ignores these.
    case 'ELEMENT_SELECTION':
    case 'KEYSTROKE_UPDATE':
    case 'CANCEL_ELEMENT_SELECTOR':
    case 'WORKFLOW_STEP':
      return false;

    default:
      // Offscreen-targeted messages (OFFSCREEN_PLAY_SOUND / GENERATE_GIF /
      // REVOKE_BLOB_URL) are handled by the offscreen document; SW no-ops.
      void sender;
      return false;
  }
});

// ───────────────────────── 定时任务（对齐官方 EXECUTE_SCHEDULED_TASK） ─────────────────────────
//
// alarm 触发时：
//  - 若有 sidepanel port → 入队，侧栏 drain 后执行
//  - 否则官方路径：新开浏览窗口 + sidepanel popup 窗口执行任务
//  - once → 禁用；monthly/annually → 重算下次 when

/**
 * Official `be()`: windows.create(url) + popup sidepanel.html?mode=window&sessionId=…
 * then deliver prompt via queue (sidepanel drains on connect).
 */
async function executeScheduledTaskWindow(s: Schedule): Promise<void> {
  const sessionId = `session_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
  const startUrl =
    s.tabUrl && /^https?:\/\//i.test(s.tabUrl) ? s.tabUrl : 'about:blank';

  const browserWin = await chrome.windows.create({
    url: startUrl,
    type: 'normal',
    focused: true,
  });
  if (!browserWin?.id || !browserWin.tabs?.[0]?.id) {
    throw new Error('Failed to create window for scheduled task');
  }

  // Enqueue before opening panel so the first drain sees the task.
  await enqueuePrompt({
    scheduleId: s.id,
    title: s.title,
    prompt: s.prompt,
    tabUrl: s.tabUrl,
  });

  const panelUrl =
    chrome.runtime.getURL('src/sidepanel/index.html') +
    `?mode=window&sessionId=${encodeURIComponent(sessionId)}&scheduled=1`;

  const panelWin = await chrome.windows.create({
    url: panelUrl,
    type: 'popup',
    width: 500,
    height: 768,
    left: 100,
    top: 100,
    focused: true,
  });
  if (!panelWin) {
    throw new Error('Failed to create sidepanel window');
  }

  // Also try official sidePanel API for the browser window (best-effort).
  try {
    await chrome.sidePanel.open({ windowId: browserWin.id });
  } catch {
    /* popup panel is the reliable path */
  }
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (!alarm.name.startsWith(ALARM_PREFIX)) return;
  void (async () => {
    const s = await getScheduleByAlarmName(alarm.name);
    if (!s || !s.enabled) return;

    try {
      if (sidepanelPorts > 0) {
        await enqueuePrompt({
          scheduleId: s.id,
          title: s.title,
          prompt: s.prompt,
          tabUrl: s.tabUrl,
        });
      } else {
        // Official: open task window + agent panel (do not only notify).
        try {
          await executeScheduledTaskWindow(s);
        } catch (e) {
          try {
            await chrome.notifications.create({
              type: 'basic',
              iconUrl: chrome.runtime.getURL('public/icons/icon-128.png'),
              title: 'Scheduled Task Failed',
              message: `Task "${s.title}" failed to execute. ${
                e instanceof Error ? e.message : String(e)
              }`,
              priority: 2,
            });
          } catch {
            /* notifications may be blocked */
          }
        }
      }
    } finally {
      // once disable; monthly/annually recompute next when (official).
      try {
        await rescheduleAfterFire(s.id);
      } catch {
        /* ignore */
      }
    }
  })();
});

// ───────────────────────── 启动 ─────────────────────────

watchSettings();
void loadSettings();
void reclaimStaleSessions();
void resyncAllAlarms();
// Open MCP: connectNative to Desktop / Claude Code hosts when present.
installNativeHost();
// Official offscreen doc: keepalive + sound + GENERATE_GIF.
void ensureOffscreenDocument();
