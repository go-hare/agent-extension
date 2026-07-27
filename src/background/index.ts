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
  resyncAllAlarms,
} from '@/scheduling/store';

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
});

chrome.runtime.onStartup.addListener(async () => {
  await loadSettings();
  await reclaimStaleSessions();
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
 * 侧栏断开 = 任务结束 = 必须 detach。
 *
 * 不 detach 的话，页面顶部的"XX 正在调试此浏览器"横幅会一直挂着，
 * 用户会以为扩展还在偷偷操作。
 *
 * 同时计数 sidepanel port，供定时任务决定是入队还是只发通知。
 */
let sidepanelPorts = 0;

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'sidepanel') return;
  sidepanelPorts += 1;
  port.onDisconnect.addListener(() => {
    sidepanelPorts = Math.max(0, sidepanelPorts - 1);
    void detachAll();
  });
});

// ───────────────────────── 消息 ─────────────────────────

type Msg =
  | { type: 'OPEN_OPTIONS' }
  | { type: 'PLAY_NOTIFICATION_SOUND' }
  | { type: 'SHOW_NOTIFICATION'; title: string; message: string }
  | { type: 'RESIZE_WINDOW'; windowId: number; width: number; height: number }
  // Teach Claude ephemeral inject messages; SW ignores so sidepanel receives them.
  | { type: 'ELEMENT_SELECTION' }
  | { type: 'KEYSTROKE_UPDATE' }
  | { type: 'CANCEL_ELEMENT_SELECTOR' }
  | { type: 'WORKFLOW_STEP'; step?: unknown };

chrome.runtime.onMessage.addListener((msg: Msg, _sender, sendResponse) => {
  switch (msg?.type) {
    case 'OPEN_OPTIONS':
      void chrome.runtime.openOptionsPage();
      sendResponse({ ok: true });
      return false;

    case 'SHOW_NOTIFICATION':
      void chrome.notifications.create({
        type: 'basic',
        iconUrl: chrome.runtime.getURL('public/icons/icon-128.png'),
        title: msg.title,
        message: msg.message,
      });
      sendResponse({ ok: true });
      return false;

    case 'RESIZE_WINDOW':
      void chrome.windows
        .update(msg.windowId, { width: msg.width, height: msg.height, state: 'normal' })
        .then(() => sendResponse({ ok: true }))
        .catch((e: unknown) =>
          sendResponse({ ok: false, error: e instanceof Error ? e.message : String(e) }),
        );
      return true; // 异步回复

    // Teach Claude: sidepanel owns recording; SW just ignores these.
    case 'ELEMENT_SELECTION':
    case 'KEYSTROKE_UPDATE':
    case 'CANCEL_ELEMENT_SELECTOR':
    case 'WORKFLOW_STEP':
      return false;

    default:
      return false;
  }
});

// ───────────────────────── 定时任务 MVP ─────────────────────────
//
// 真实 agent 需要侧栏开着。alarm 触发时：
//  - 若有 sidepanel port → 把 prompt 塞进 session queue，侧栏 drain 后执行
//  - 否则发通知，请用户打开 Agent

chrome.alarms.onAlarm.addListener((alarm) => {
  if (!alarm.name.startsWith(ALARM_PREFIX)) return;
  void (async () => {
    const s = await getScheduleByAlarmName(alarm.name);
    if (!s || !s.enabled) return;
    if (sidepanelPorts > 0) {
      await enqueuePrompt({
        scheduleId: s.id,
        title: s.title,
        prompt: s.prompt,
      });
      return;
    }
    try {
      await chrome.notifications.create({
        type: 'basic',
        iconUrl: chrome.runtime.getURL('public/icons/icon-128.png'),
        title: 'Scheduled task waiting',
        message: `"${s.title}" is ready — open Agent to run it.`,
      });
    } catch {
      /* notifications may be blocked */
    }
  })();
});

// ───────────────────────── 启动 ─────────────────────────

watchSettings();
void loadSettings();
void reclaimStaleSessions();
void resyncAllAlarms();
