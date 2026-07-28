/**
 * 侧栏会话状态机。
 *
 * 这个 hook 是整个 UI 的心脏：它持有
 *  - `apiMessages`（给模型看的合法历史，**ref 而非 state**）
 *  - `items`（给人看的 transcript，state）
 *  - 运行状态 / 中止句柄 / 当前锚定的 tab
 *
 * 为什么 apiMessages 用 ref：agent loop 是**就地 push** 这个数组的
 * （见 loop.ts 的 RunOptions.messages 注释）。如果它是 state，loop 拿到的
 * 是某一次渲染时的快照，push 进去的东西会在下次 setState 时被覆盖掉，
 * 表现成"模型忘记了自己刚说过的话"。ref 保证 loop 和 UI 看到的是同一个数组。
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { MessageParam } from '@anthropic-ai/sdk/resources/messages';
import { answerPermission, runTurn, type AgentEvent } from '@/sidepanel/agent/loop';
import { permissionManager } from '@/permissions/manager';
import { cleanupTools, clearTodos, clearSessionMedia } from '@/tools/registry';
import { hideAllIndicators, hideIndicator, showIndicator } from '@/tools/tabs';
import { setShortcutRunner } from '@/tools/shortcuts';
import { hasUsableCredentials, peekSettings } from '@/storage/settings';
import type { PermissionScope } from '@/shared/types';
import { drainQueue, requeueFront } from '@/scheduling/store';
import { resolveActiveBrowserTab } from '@/tabs/activeTab';
import {
  loadNotificationsPref,
  notifyTaskDone,
} from '@/notifications/prefs';
import { getUiStrings } from '@/i18n/ui';
import {
  addCompletionPrefix,
  addLoadingPrefix,
  addPermissionPrefix,
  removeCompletionPrefix,
  removeGroupPrefix,
} from '@/tabs/groupManager';
import {
  generateWorkingStatus,
  heuristicStatus,
  pickStatusSourceText,
} from '@/sidepanel/agent/workingStatus';
import {
  addNotice,
  addPermission,
  appendText,
  dropEmptyText,
  endTool,
  nextId,
  resolvePermission,
  sealStreaming,
  settleAll,
  startTool,
  type TranscriptItem,
} from './transcript';

export interface Usage {
  inputTokens: number;
  outputTokens: number;
}

/** 侧栏附件：已写入 media catalog，带 id 供 upload 工具引用。 */
export interface OutgoingAttachment {
  kind: 'image' | 'file';
  id: string;
  name: string;
  mimeType: string;
  /** raw base64，无 data: 前缀；图片会进 API image block */
  data: string;
}

export interface SendPayload {
  text: string;
  attachments?: OutgoingAttachment[];
}

export interface SessionState {
  items: TranscriptItem[];
  running: boolean;
  /** 有权限气泡在等回答 —— 输入框应当禁用，因为 loop 挂起了 */
  awaitingPermission: boolean;
  /**
   * Official StatusPill working text (NG / generateWorkingStatus).
   * Goal-oriented ≤7 words, e.g. "Gathering page content" — not fixed "Working".
   */
  workingStatus: string | null;
  usage: Usage;
  tab: { id: number; windowId: number; url: string; title: string } | null;
  send: (text: string, attachments?: OutgoingAttachment[]) => void;
  stop: () => void;
  reset: () => void;
  answer: (toolUseId: string, granted: boolean, scope: PermissionScope) => void;
}

export function useSession(): SessionState {
  const [items, setItems] = useState<TranscriptItem[]>([]);
  const [running, setRunning] = useState(false);
  const [awaitingPermission, setAwaiting] = useState(false);
  const [workingStatus, setWorkingStatus] = useState<string | null>(null);
  const [usage, setUsage] = useState<Usage>({ inputTokens: 0, outputTokens: 0 });
  const [tab, setTab] = useState<SessionState['tab']>(null);

  const apiMessages = useRef<MessageParam[]>([]);
  const abortRef = useRef<AbortController | null>(null);
  // send 的稳定引用，给 shortcut / schedule 回调用（声明须早于 useEffect）
  const sendRef = useRef<SessionState['send'] | null>(null);
  /** Stop Claude pill on the page → runtime message → abort the turn. */
  const stopRef = useRef<SessionState['stop'] | null>(null);
  // turn 结束后再 drain 定时队列
  const pullSchedulesRef = useRef<(() => void) | null>(null);
  /** Dedup / cancel in-flight generateWorkingStatus (official NG). */
  const statusGenRef = useRef<AbortController | null>(null);
  const statusGenSeq = useRef(0);
  /** Tools seen this turn — heuristic fallback + skip re-LLM on pure reads. */
  const turnToolNamesRef = useRef<string[]>([]);
  /** Anchored tab id for group-title prefixes (official ⌛/🔔/✅). */
  const tabIdRef = useRef<number | null>(null);

  // ── 锚定当前 tab ──
  //
  // 侧栏是 per-window 的，用户切 tab 时 agent 应该跟着切。
  // 但**运行中不切** —— 任务跑到一半换目标页面是灾难性的（想象一下
  // 正在填的表单突然变成另一个网站）。
  const runningRef = useRef(false);
  runningRef.current = running;

  const syncTab = useCallback(async () => {
    if (runningRef.current) return;
    // Side panel is not a normal window: currentWindow often misses the browser tab.
    const active = await resolveActiveBrowserTab();
    if (!active) return;
    tabIdRef.current = active.id;
    setTab(active);
  }, []);

  useEffect(() => {
    void permissionManager.init();
    void syncTab();

    // shortcuts_execute → 新 turn
    setShortcutRunner((prompt, meta) => {
      // 避免与 running 竞态：若正在跑，排队到下一 tick 用 notice 提示
      if (runningRef.current) {
        setItems((prev) =>
          addNotice(
            prev,
            'error',
            `Shortcut "/${meta.command}" could not start — agent is already running. Try again when idle.`,
          ),
        );
        return;
      }
      sendRef.current?.(
        `[Shortcut: ${meta.title}]\n${prompt}`,
      );
    });

    // 定时任务队列：侧栏打开时 drain。
    // 规则：busy → 全部写回；idle → 只发第一条，剩余写回（turn 结束后再 pull）。
    const pullSchedules = () => {
      void drainQueue().then(async (items) => {
        if (items.length === 0) return;
        if (runningRef.current) {
          await requeueFront(items);
          setItems((prev) =>
            addNotice(
              prev,
              'info',
              items.length === 1
                ? `Scheduled task "${items[0].title}" is waiting — agent busy.`
                : `${items.length} scheduled tasks are waiting — agent busy.`,
            ),
          );
          return;
        }
        const [first, ...rest] = items;
        if (rest.length) await requeueFront(rest);
        sendRef.current?.(`[Scheduled: ${first.title}]\n${first.prompt}`);
      });
    };
    pullSchedulesRef.current = pullSchedules;
    pullSchedules();
    const onStorage = (
      changes: { [key: string]: chrome.storage.StorageChange },
      area: string,
    ) => {
      if (area === 'session' && changes.schedule_queue) pullSchedules();
    };
    chrome.storage.onChanged.addListener(onStorage);

    const onActivated = () => void syncTab();
    /*
     * 类型是 `OnUpdatedInfo`，不是 `TabChangeInfo` —— 后者是 @types/chrome
     * 旧版本的名字，0.1.28 里已经不存在了。
     *
     * 只在 `status === 'complete'` 或 URL 变了的时候重新取标签页：
     * onUpdated 在一次导航里会连续触发很多次（favIconUrl、title、
     * audible、discarded…），每次都 query 一遍纯属浪费，而且会在页面
     * 加载途中把 tab.title 写成中间态（比如空串）。
     */
    const onUpdated = (_id: number, info: chrome.tabs.OnUpdatedInfo) => {
      if (info.status === 'complete' || info.url) void syncTab();
    };
    const onFocus = () => void syncTab();

    chrome.tabs.onActivated.addListener(onActivated);
    chrome.tabs.onUpdated.addListener(onUpdated);
    chrome.windows.onFocusChanged.addListener(onFocus);

    // 告诉 SW 侧栏活着 —— port 断开时 SW 会 detachAll()，
    // 这是"侧栏一关就摘掉调试横幅"的唯一可靠信号。
    const port = chrome.runtime.connect({ name: 'sidepanel' });

    // Official Stop Claude pill on the page → STOP_AGENT → sidepanel aborts.
    const onRuntimeMsg = (msg: { type?: string }) => {
      if (msg?.type === 'STOP_AGENT_REQUEST') {
        stopRef.current?.();
      }
    };
    chrome.runtime.onMessage.addListener(onRuntimeMsg);

    return () => {
      chrome.tabs.onActivated.removeListener(onActivated);
      chrome.tabs.onUpdated.removeListener(onUpdated);
      chrome.windows.onFocusChanged.removeListener(onFocus);
      chrome.storage.onChanged.removeListener(onStorage);
      chrome.runtime.onMessage.removeListener(onRuntimeMsg);
      setShortcutRunner(null);
      pullSchedulesRef.current = null;
      port.disconnect();
    };
  }, [syncTab]);

  // ── 页面卸载时收摊 ──
  useEffect(() => {
    const onUnload = () => {
      abortRef.current?.abort();
      void cleanupTools();
    };
    window.addEventListener('pagehide', onUnload);
    return () => window.removeEventListener('pagehide', onUnload);
  }, []);

  /**
   * Official NG: refresh StatusPill from latest user/assistant text.
   * Instant heuristic first, then async LLM polish (may no-op on failure).
   */
  const refreshWorkingStatus = useCallback(
    (sourceItems: TranscriptItem[], toolNames: string[]) => {
      const source = pickStatusSourceText(
        sourceItems.map((it) => ({
          kind: it.kind,
          text: 'text' in it && typeof it.text === 'string' ? it.text : undefined,
        })),
      );
      const quick = heuristicStatus(source, toolNames);
      if (quick) setWorkingStatus(quick);

      statusGenRef.current?.abort();
      const ac = new AbortController();
      statusGenRef.current = ac;
      const seq = ++statusGenSeq.current;
      void generateWorkingStatus(source, ac.signal).then((s) => {
        if (seq !== statusGenSeq.current) return;
        if (ac.signal.aborted) return;
        if (s) setWorkingStatus(s);
      });
    },
    [],
  );

  const handleEvent = useCallback(
    (e: AgentEvent) => {
      switch (e.type) {
        case 'text_delta':
          setItems((prev) => appendText(prev, e.text));
          break;

        case 'thinking_delta':
          // 目前不展示思考流（原版也默认折叠）。留着分支是为了
          // 显式说明"我们知道有这个事件，选择不渲染"，而不是漏掉。
          break;

        case 'tool_start':
          turnToolNamesRef.current = [...turnToolNamesRef.current, e.name];
          // Official page chrome (glow + cursor + Stop) for interactive tools.
          // computer/form_input/navigate also call showIndicator themselves;
          // arm early here so the border appears as soon as the tool row starts.
          if (
            tabIdRef.current != null &&
            [
              'computer',
              'form_input',
              'navigate',
              'file_upload',
              'upload_image',
              'javascript_tool',
            ].includes(e.name)
          ) {
            void showIndicator(tabIdRef.current);
          }
          setItems((prev) => {
            const next = startTool(dropEmptyText(prev), e.id, e.name, e.input);
            // Official: first tool_use in a burst → NG(status). Re-run when a
            // non-read tool appears so "clicking" goals still update.
            const names = turnToolNamesRef.current;
            const isFirst = names.length === 1;
            const READISH = new Set(['read_page', 'get_page_text', 'find']);
            const isMeaningful = !READISH.has(e.name);
            if (isFirst || isMeaningful) {
              // Defer so state flush of startTool is visible; pass `next`.
              queueMicrotask(() => refreshWorkingStatus(next, names));
            }
            return next;
          });
          break;

        case 'tool_end':
          setItems((prev) => endTool(prev, e.id, e.result));
          break;

        case 'permission_request':
          setAwaiting(true);
          setItems((prev) => addPermission(prev, e.request));
          // Official: 🔔 on the Claude tab group while a permission card is up.
          if (tabIdRef.current != null) {
            void addPermissionPrefix(tabIdRef.current);
          }
          break;

        case 'permission_resolved': {
          const stillPending = permissionManager.hasPending();
          setAwaiting(stillPending);
          // Official: 🔔 while any permission card is open; else ⌛ if still running.
          if (tabIdRef.current != null) {
            if (stillPending) void addPermissionPrefix(tabIdRef.current);
            else if (runningRef.current) void addLoadingPrefix(tabIdRef.current);
          }
          break;
        }

        case 'usage':
          setUsage((u) => ({
            inputTokens: u.inputTokens + e.inputTokens,
            outputTokens: u.outputTokens + e.outputTokens,
          }));
          break;

        case 'error':
          setItems((prev) => addNotice(dropEmptyText(prev), 'error', e.message));
          break;

        case 'turn_end':
          setItems((prev) => sealStreaming(dropEmptyText(prev)));
          // Keep last status until running flips false (pill becomes "N steps").
          break;

        case 'turn_start':
          turnToolNamesRef.current = [];
          break;
      }
    },
    [refreshWorkingStatus],
  );

  const send = useCallback(
    (text: string, attachments?: OutgoingAttachment[]) => {
      const trimmed = text.trim();
      const files = attachments ?? [];
      if ((!trimmed && files.length === 0) || runningRef.current) return;

      if (!hasUsableCredentials(peekSettings())) {
        setItems((prev) =>
          addNotice(
            prev,
            'error',
            'No API base URL / key configured yet. Open the extension options to set them.',
          ),
        );
        return;
      }
      if (!tab) {
        setItems((prev) => addNotice(prev, 'error', 'No active tab. Focus a normal website tab.'));
        return;
      }

      const chipNote =
        files.length === 0
          ? ''
          : files
              .map((f) =>
                f.kind === 'image'
                  ? `[Attached image imageId=${f.id} filename=${f.name}]`
                  : `[Attached file fileId=${f.id} name=${f.name} mime=${f.mimeType} — use file_upload with this fileId]`,
              )
              .join('\n');
      // UI bubble: plain user text + image thumbs (official HumanMessage).
      // Model still receives chipNote so upload_image / file tools can resolve ids.
      const displayText = trimmed || (files.length ? '' : '');
      const uiAttachments = files.map((f) => ({
        kind: f.kind,
        id: f.id,
        name: f.name,
        mimeType: f.mimeType,
        previewUrl:
          f.kind === 'image'
            ? `data:${f.mimeType};base64,${f.data}`
            : undefined,
      }));

      setItems((prev) => [
        ...prev,
        {
          kind: 'user',
          id: nextId('usr'),
          text: displayText,
          attachments: uiAttachments.length ? uiAttachments : undefined,
          at: Date.now(),
        },
      ]);

      // API content：文本 + 图片 block（文件只进 catalog + 文本 note）
      type ContentPart =
        | { type: 'text'; text: string }
        | {
            type: 'image';
            source: {
              type: 'base64';
              media_type: 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif';
              data: string;
            };
          };

      const content: ContentPart[] = [];
      const body = [trimmed, chipNote].filter(Boolean).join('\n\n');
      if (body) content.push({ type: 'text', text: body });
      for (const f of files) {
        if (f.kind !== 'image') continue;
        const media_type = (
          f.mimeType === 'image/jpeg' ||
          f.mimeType === 'image/webp' ||
          f.mimeType === 'image/gif' ||
          f.mimeType === 'image/png'
            ? f.mimeType
            : 'image/png'
        ) as 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif';
        content.push({
          type: 'image',
          source: { type: 'base64', media_type, data: f.data },
        });
      }

      apiMessages.current.push({
        role: 'user',
        content: content.length === 1 && content[0].type === 'text' ? content[0].text : content,
      });

      const ac = new AbortController();
      abortRef.current = ac;
      tabIdRef.current = tab.id;
      turnToolNamesRef.current = [];
      // Seed pill immediately from the user message (official shows goal ASAP).
      const seed = heuristicStatus(trimmed || displayText, []);
      setWorkingStatus(seed || null);
      setRunning(true);
      // Official: drop ✅ then show ⌛ while the agent is working.
      void removeCompletionPrefix(tab.id).then(() => addLoadingPrefix(tab.id));

      void runTurn({
        messages: apiMessages.current,
        tabId: tab.id,
        windowId: tab.windowId,
        signal: ac.signal,
        emit: handleEvent,
      })
        .catch((err: unknown) => {
          // runTurn 内部已经把绝大多数错误转成 error 事件了；
          // 走到这里说明是 loop 自己炸了，属于 bug，要让用户看见。
          setItems((prev) =>
            addNotice(prev, 'error', err instanceof Error ? err.message : String(err)),
          );
        })
        .finally(() => {
          const finishedTabId = tab.id;
          setRunning(false);
          setAwaiting(false);
          abortRef.current = null;
          statusGenRef.current?.abort();
          statusGenRef.current = null;
          // Pill switches to "N steps" — clear LLM status so next turn starts fresh.
          setWorkingStatus(null);
          turnToolNamesRef.current = [];
          setItems((prev) => sealStreaming(dropEmptyText(prev)));
          // Official: tear down glow / phantom cursor / Stop pill when the turn ends.
          void hideIndicator(finishedTabId);
          void syncTab();
          // Official: ✅ on the group chip when the turn ends (not aborted mid-flight).
          if (!ac.signal.aborted) {
            void addCompletionPrefix(finishedTabId);
          } else {
            void removeGroupPrefix(finishedTabId);
          }
          // 上一条 turn 结束后再消费排队的定时任务
          pullSchedulesRef.current?.();
          // Official gt: OS notify when pref is "enabled" (and panel may be hidden).
          void loadNotificationsPref().then((pref) => {
            if (pref !== 'enabled') return;
            const ui = getUiStrings(peekSettings().locale);
            void notifyTaskDone({
              title: ui.notifyDoneTitle,
              message: ui.notifyDoneBody,
            });
          });
        });
    },
    [tab, handleEvent, syncTab],
  );

  const stop = useCallback(() => {
    abortRef.current?.abort();
    statusGenRef.current?.abort();
    statusGenRef.current = null;
    // 挂起的权限请求也要解开，否则 loop 会永远 await 下去
    permissionManager.abortAll();
    setAwaiting(false);
    setWorkingStatus(null);
    setItems((prev) => settleAll(prev, 'Stopped by the user.'));
    if (tabIdRef.current != null) void removeGroupPrefix(tabIdRef.current);
    void hideAllIndicators();
  }, []);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    statusGenRef.current?.abort();
    statusGenRef.current = null;
    permissionManager.abortAll();
    if (tabIdRef.current != null) void removeGroupPrefix(tabIdRef.current);
    apiMessages.current = [];
    setItems([]);
    setUsage({ inputTokens: 0, outputTokens: 0 });
    setAwaiting(false);
    setWorkingStatus(null);
    turnToolNamesRef.current = [];
    clearTodos();
    clearSessionMedia();
    void cleanupTools();
  }, []);

  const answer = useCallback(
    (toolUseId: string, granted: boolean, scope: PermissionScope) => {
      setItems((prev) => resolvePermission(prev, toolUseId, granted, scope));
      void answerPermission(toolUseId, granted, scope);
    },
    [],
  );

  sendRef.current = send;
  stopRef.current = stop;

  return {
    items,
    running,
    awaitingPermission,
    workingStatus,
    usage,
    tab,
    send,
    stop,
    reset,
    answer,
  };
}
