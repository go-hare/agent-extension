/**
 * 侧栏根组件。
 *
 * 外壳 className 逐字取自原版的 React root：
 *   flex flex-col h-screen bg-bg-100     data-theme="claude"
 *
 * 首次打开顺序（对齐官方）：
 *   1. Before you start（风险确认，一次）
 *   2. Claude has tab group access（IZ，一次）
 *   3. 空对话时 Pin Claude tip（一次）
 *   4. 正常 EmptyState / transcript
 *   + 打开时把锚定 tab 收进橙色 "Claude" 分组；同组次要 tab 显示 RZ
 *   + 输入框上方 BM 通知条（Notify me + 铃铛），未设置 notificationsEnabled 时
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Composer, type SlashCommand } from './components/Composer';
import { EmptyState } from './components/EmptyState';
import { Header } from './components/Header';
import { TodoList } from './components/TodoList';
import { Transcript } from './components/Transcript';
import {
  PermissionBubble,
  PermissionStickyShell,
} from './components/PermissionBubble';
import { BeforeYouStart } from './components/BeforeYouStart';
import { ComposerBanner } from './components/ComposerBanner';
import { PinOnboarding } from './components/PinOnboarding';
import { ProductExplainer, type ExplainerKind } from './components/ProductExplainer';
import { SkipModeBorder } from './components/SkipModeBorder';
import {
  SecondaryTabScreen,
  TabGroupAccessOnboarding,
} from './components/TabGroupScreens';
import { TeachClaude, type TeachPhase } from './components/TeachClaude';
import { useSession } from './state/useSession';
import { clearTodos, getTodos, subscribeTodos } from './state/todos';
import { applyMode, bootstrapTheme, watchSystemMode, type Mode } from './theme';
import { hasUsableCredentials, loadSettings, saveSettings, watchSettings } from '@/storage/settings';
import { DEFAULT_SETTINGS, type Settings } from '@/shared/types';
import type { TodoItem } from './components/TodoList';
import { listShortcuts, type Shortcut } from '@/shortcuts/store';
import { UiLocaleProvider, useUi } from '@/i18n/UiLocaleContext';
import { getUiStrings, type UiLocale } from '@/i18n/ui';
import { loadOnboarding, patchOnboarding, type OnboardingFlags } from '@/onboarding/store';
import { convertAndCreateSchedule } from '@/scheduling/convertConversation';
import type { PermissionItem } from './state/transcript';
import {
  loadNotificationsPref,
  setNotificationsPref,
  type NotificationsPref,
} from '@/notifications/prefs';
import { classifyTab, ensureClaudeGroup } from '@/tabs/groupManager';
import { PairingPrompt } from '@/pairing/PairingPrompt';

export function App() {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [mode, setMode] = useState<Mode>(() => bootstrapTheme());

  useEffect(() => {
    void loadSettings().then((s) => {
      setSettings(s);
      setMode(s.mode);
      applyMode(s.mode);
    });
    watchSettings((s) => {
      setSettings(s);
      setMode(s.mode);
      applyMode(s.mode);
    });
  }, []);

  useEffect(() => {
    return watchSystemMode(() => {
      if (mode === 'system') applyMode('system');
    });
  }, [mode]);

  useEffect(() => {
    document.title = getUiStrings(settings.locale).sidepanelTitle;
  }, [settings.locale]);

  const patchSettings = useCallback(async (patch: Partial<Settings>) => {
    const next = await saveSettings(patch);
    setSettings(next);
  }, []);

  return (
    <UiLocaleProvider locale={settings.locale}>
      <AppShell settings={settings} patchSettings={patchSettings} />
    </UiLocaleProvider>
  );
}

function AppShell({
  settings,
  patchSettings,
}: {
  settings: Settings;
  patchSettings: (patch: Partial<Settings>) => Promise<void>;
}) {
  const t = useUi();
  const session = useSession();
  const [todos, setTodosState] = useState<TodoItem[]>(() => getTodos());
  const [shortcuts, setShortcuts] = useState<Shortcut[]>([]);
  const [onboarding, setOnboarding] = useState<OnboardingFlags | null>(null);
  const [explainer, setExplainer] = useState<ExplainerKind | null>(null);
  const [teachPhase, setTeachPhase] = useState<TeachPhase | null>(null);
  /** Official notificationsEnabled — undefined means banner eligible. */
  const [notifPref, setNotifPref] = useState<NotificationsPref>(undefined);
  const [showNotifBanner, setShowNotifBanner] = useState(false);
  /** Secondary tab in a managed Claude group → RZ screen. */
  const [secondaryMainTabId, setSecondaryMainTabId] = useState<number | null>(null);
  const groupBootstrappedFor = useRef<number | null>(null);
  /** Official show_pairing_prompt overlay (Desktop / Claude Code). */
  const [pairingPrompt, setPairingPrompt] = useState<{
    requestId: string;
    clientType: string;
    currentName?: string;
  } | null>(null);

  useEffect(() => subscribeTodos(setTodosState), []);

  // Official: SW forwards pairing_request as show_pairing_prompt when panel is open.
  useEffect(() => {
    const onMsg = (
      msg: {
        type?: string;
        request_id?: string;
        client_type?: string;
        current_name?: string;
      },
      _sender: chrome.runtime.MessageSender,
      sendResponse: (r: unknown) => void,
    ) => {
      if (msg?.type !== 'show_pairing_prompt') return;
      const requestId = msg.request_id;
      if (!requestId) {
        sendResponse({ handled: false });
        return true;
      }
      setPairingPrompt({
        requestId,
        clientType: msg.client_type || 'desktop',
        currentName: msg.current_name || undefined,
      });
      sendResponse({ handled: true });
      return true;
    };
    chrome.runtime.onMessage.addListener(onMsg);
    return () => chrome.runtime.onMessage.removeListener(onMsg);
  }, []);

  useEffect(() => {
    void loadOnboarding().then(setOnboarding);
  }, []);

  useEffect(() => {
    void loadNotificationsPref().then((pref) => {
      setNotifPref(pref);
      // Official: show banner only while preference is still unset.
      if (pref === undefined) setShowNotifBanner(true);
    });
  }, []);

  /**
   * Official open path: ensure the anchored tab lives in an orange "Claude"
   * group; if this panel is on a secondary group member, show RZ hand-off.
   */
  useEffect(() => {
    const tabId = session.tab?.id;
    if (!tabId || session.running) return;
    if (groupBootstrappedFor.current === tabId) return;
    groupBootstrappedFor.current = tabId;

    void (async () => {
      try {
        const role = await classifyTab(tabId);
        if (role.kind === 'secondary') {
          setSecondaryMainTabId(role.mainTabId);
          return;
        }
        setSecondaryMainTabId(null);
        if (role.kind === 'ungrouped') {
          await ensureClaudeGroup(tabId);
        }
      } catch {
        /* tabGroups API may be missing on older Chrome */
      }
    })();
  }, [session.tab?.id, session.running]);

  useEffect(() => {
    void listShortcuts().then(setShortcuts);
    const onStorage = (
      changes: { [key: string]: chrome.storage.StorageChange },
      area: string,
    ) => {
      if (area === 'local' && changes.shortcuts) {
        void listShortcuts().then(setShortcuts);
      }
    };
    chrome.storage.onChanged.addListener(onStorage);
    return () => chrome.storage.onChanged.removeListener(onStorage);
  }, []);

  const openOptions = useCallback(() => {
    void chrome.runtime.openOptionsPage();
  }, []);

  const onPermissionModeChange = useCallback(
    (permissionMode: Settings['permissionMode']) => {
      void patchSettings({ permissionMode });
    },
    [patchSettings],
  );

  const onSelectModel = useCallback(
    (model: string) => {
      void patchSettings({ model });
    },
    [patchSettings],
  );

  const onSelectLocale = useCallback(
    (locale: UiLocale) => {
      // Official: language change starts a new chat (confirm is in Header).
      session.reset();
      clearTodos();
      void patchSettings({ locale });
    },
    [patchSettings, session],
  );

  const onClear = useCallback(() => {
    session.reset();
    clearTodos();
  }, [session]);

  /**
   * Official FZ “Convert to task”: LLM extracts <scheduled_task> XML
   * (title/prompt/frequency/url/datetime) then opens Options on the new schedule.
   */
  const onConvertToTask = useCallback(async () => {
    if (session.running) return;
    // Transcript: user turns are kind:'user'; assistant text is kind:'text'.
    const convertible: Array<{ kind: string; text: string }> = [];
    for (const i of session.items) {
      if (i.kind === 'user' && i.text?.trim()) {
        convertible.push({ kind: 'user', text: i.text });
      } else if (i.kind === 'text' && i.text?.trim()) {
        convertible.push({ kind: 'assistant', text: i.text });
      }
    }
    if (convertible.length === 0) return;

    try {
      await convertAndCreateSchedule({
        items: convertible,
        currentUrl: session.tab?.url,
      });
      void chrome.runtime.openOptionsPage();
    } catch (e) {
      console.warn('[convertToTask]', e);
      throw e;
    }
  }, [session.items, session.running, session.tab?.url]);

  const finishBeforeYouStart = useCallback(() => {
    void patchOnboarding({ beforeYouStartDone: true }).then(setOnboarding);
  }, []);

  const finishTabGroupOnboarding = useCallback(() => {
    void patchOnboarding({ tabGroupAccessShown: true }).then(setOnboarding);
  }, []);

  const dismissPin = useCallback(() => {
    void patchOnboarding({ pinTipShown: true }).then(setOnboarding);
  }, []);

  const enableNotifications = useCallback(() => {
    void setNotificationsPref('enabled').then(() => {
      setNotifPref('enabled');
      setShowNotifBanner(false);
    });
  }, []);

  const dismissNotificationBanner = useCallback(() => {
    void setNotificationsPref('disabled').then(() => {
      setNotifPref('disabled');
      setShowNotifBanner(false);
    });
  }, []);

  const configured = hasUsableCredentials(settings);
  const empty = session.items.length === 0;

  // Official: StatusPill lives in-transcript. Working text is goal-oriented
  // (generateWorkingStatus / NG) — e.g. "Gathering page content" — not fixed "Working".
  const statusText = session.awaitingPermission
    ? t.waitingForPermission
    : session.workingStatus?.trim() || t.working;

  /**
   * Official permission UX:
   *   o.permissionPrompt → absolute bottom sticky overlay (z-10), NOT inline
   *   messages paddingBottom = n>0 ? n-80 : 40
   * Answered permission rows stay in the transcript as compact history.
   */
  const pendingPermission = useMemo((): PermissionItem | null => {
    for (let i = session.items.length - 1; i >= 0; i -= 1) {
      const it = session.items[i]!;
      if (it.kind === 'permission' && it.answer === undefined) return it;
    }
    return null;
  }, [session.items]);

  const permissionPromptRef = useRef<HTMLDivElement>(null);
  const [permissionPromptHeight, setPermissionPromptHeight] = useState(0);
  /** Official sticky: pr-2 when messages scroller overflows. */
  const [scrollerOverflow, setScrollerOverflow] = useState(false);

  useLayoutEffect(() => {
    if (!pendingPermission) {
      setPermissionPromptHeight(0);
      return;
    }
    const el = permissionPromptRef.current;
    if (!el) return;

    const measure = () => setPermissionPromptHeight(el.offsetHeight);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [pendingPermission, pendingPermission?.id]);

  // Official: paddingBottom: n>0 ? n-80+"px" : "40px"
  const transcriptBottomPad =
    permissionPromptHeight > 0
      ? `${Math.max(0, permissionPromptHeight - 80)}px`
      : '40px';

  const send = session.send;
  const openTeach = useCallback(() => setTeachPhase('intro'), []);
  const closeTeach = useCallback(() => setTeachPhase(null), []);

  const onTeachSaved = useCallback(
    (prompt: string, meta: { command: string; title: string }) => {
      void listShortcuts().then(setShortcuts);
      if (prompt.trim()) {
        send(`[Shortcut: ${meta.title}]\n${prompt}`);
      }
    },
    [send],
  );

  const commands = useMemo<SlashCommand[]>(() => {
    const builtIn: SlashCommand[] = [
      {
        id: 'clear',
        label: t.clearChat,
        description: 'Start a new conversation and clear the checklist.',
        run: onClear,
      },
      {
        id: 'settings',
        label: t.settings,
        description: 'Open the extension options page.',
        run: openOptions,
      },
      {
        // Official-ish teach entry (single slash — avoid /record-workflow + /teach dup).
        id: 'teach',
        label: t.teachClaude,
        description: t.teachSlashDesc,
        run: openTeach,
      },
      {
        id: 'help',
        label: 'Help',
        description: 'List available slash commands.',
        run: () => {
          send(
            'List the slash commands I can type in this composer, and briefly what each does.',
          );
        },
      },
    ];
    const fromStore: SlashCommand[] = shortcuts.map((s) => ({
      id: s.command,
      label: s.title,
      description: s.description,
      run: () => send(`[Shortcut: ${s.title}]\n${s.prompt}`),
    }));
    const byId = new Map<string, SlashCommand>();
    for (const c of [...builtIn, ...fromStore]) byId.set(c.id, c);
    return [...byId.values()];
  }, [
    onClear,
    openOptions,
    openTeach,
    send,
    shortcuts,
    t.clearChat,
    t.settings,
    t.claudeCowork,
    t.pairingTitle,
    t.teachClaude,
    t.teachSlashDesc,
  ]);

  // Gate: wait for onboarding flags
  if (onboarding === null) {
    return <div data-theme="claude" className="flex flex-col h-screen bg-bg-100" />;
  }

  if (!onboarding.beforeYouStartDone) {
    return (
      <div data-theme="claude" className="flex flex-col h-screen bg-bg-100">
        <BeforeYouStart onContinue={finishBeforeYouStart} />
      </div>
    );
  }

  // Official IZ: tab-group access explainer after risk ack (once).
  if (!onboarding.tabGroupAccessShown) {
    return (
      <div data-theme="claude" className="flex flex-col h-screen bg-bg-100">
        <TabGroupAccessOnboarding onNext={finishTabGroupOnboarding} />
      </div>
    );
  }

  // Official RZ: this side panel is on a secondary tab in a Claude group.
  if (secondaryMainTabId != null) {
    return (
      <div data-theme="claude" className="flex flex-col h-screen bg-bg-100">
        <SecondaryTabScreen
          mainTabId={secondaryMainTabId}
          onSwitched={() => setSecondaryMainTabId(null)}
        />
      </div>
    );
  }

  // Official pin tip: maxDisplays 1 on empty sidepanel (credentials optional —
  // users still need to discover the toolbar pin before setup).
  const showPin = empty && !onboarding.pinTipShown;

  // Official activeBanner: notification when pref still unset (J === undefined).
  const activeNotificationBanner = showNotifBanner && notifPref === undefined;

  // Full-panel Teach Claude flow replaces chat chrome (official nG surface).
  if (teachPhase) {
    return (
      <div data-theme="claude" className="flex flex-col h-screen bg-bg-100 relative overflow-hidden">
        <TeachClaude
          phase={teachPhase}
          tabTitle={session.tab?.title}
          tabUrl={session.tab?.url}
          tabId={session.tab?.id}
          onPhase={setTeachPhase}
          onClose={closeTeach}
          onSaved={onTeachSaved}
        />
      </div>
    );
  }

  return (
    <div data-theme="claude" className="flex flex-col h-screen bg-bg-100 relative overflow-hidden">
      {/* Official QZ: full sidepanel gold/dashed frame in skip mode */}
      <SkipModeBorder active={settings.permissionMode === 'skip'} />

      <Header
        model={settings.model}
        availableModels={settings.availableModels}
        locale={settings.locale}
        tabTitle={session.tab?.title}
        tabUrl={session.tab?.url}
        canClear={!empty || todos.length > 0}
        isAgentRunning={session.running}
        hasMessages={!empty}
        onClear={onClear}
        onOpenOptions={openOptions}
        onSelectModel={onSelectModel}
        onSelectLocale={onSelectLocale}
        onConvertToTask={onConvertToTask}
      />

      <TodoList items={todos} />

      {/*
        Chat column is relative so the official permission sticky
        (absolute bottom-0 z-[10]) sits above the composer, not the whole
        sidepanel chrome.
      */}
      <div className="relative flex-1 flex flex-col min-h-0">
        <Transcript
          items={session.items}
          onAnswer={session.answer}
          running={session.running}
          statusText={statusText}
          bottomPad={transcriptBottomPad}
          stickyPermissionId={pendingPermission?.toolUseId ?? null}
          onScrollerOverflow={setScrollerOverflow}
        >
          {showPin ? (
            <PinOnboarding onDismiss={dismissPin} />
          ) : (
            <EmptyState
              configured={configured}
              onPick={session.send}
              onOpenOptions={openOptions}
              onTeach={openTeach}
            />
          )}
        </Transcript>

        {/*
          Official sticky (sidepanel chatInput):
            children: [TipTapEditor(composer + Hz3uf5n9Ga disclaimer), hairline h-0.5]
          Working/status is NOT here — it lives in-transcript (StatusPill / DC).
          No token usage row under the disclaimer.
        */}
        <div className="sticky bottom-0 mx-auto w-full z-[5]">
          {/*
            Official chatInput stack (above TipTap):
              activeBanner → notification BM (Notify me + bell) / error / …
            Sits in px-3 pad matching official `px-3 md:px-2` wrapper.
          */}
          {activeNotificationBanner ? (
            <div className="px-3 md:px-2 bg-bg-100">
              <ComposerBanner
                type="notification"
                onAction={enableNotifications}
                onDismiss={dismissNotificationBanner}
                actionText={t.notifyMe}
                dismissLabel={t.dismissBanner}
              >
                {t.notifyBannerBody}
              </ComposerBanner>
            </div>
          ) : null}
          <Composer
            empty={empty}
            running={session.running}
            blocked={session.awaitingPermission}
            permissionMode={settings.permissionMode}
            onPermissionModeChange={onPermissionModeChange}
            onSend={session.send}
            onStop={session.stop}
            commands={commands}
            onTeach={openTeach}
            tabUrl={session.tab?.url}
            tabId={session.tab?.id}
          />
          <div className="flex justify-center py-1.5 text-text-500 bg-bg-100">
            <a
              href="https://support.anthropic.com/en/articles/8525154-claude-is-providing-incorrect-or-misleading-responses-what-s-going-on"
              target="_blank"
              rel="noopener noreferrer"
              className="text-[11px] hover:text-text-300 transition-colors text-center px-3"
            >
              {t.aiDisclaimer}
            </a>
          </div>
          <div className="bg-bg-100 h-0.5" />
        </div>

        {/*
          Official permissionPrompt sticky overlay (z-10 above composer z-5):
            absolute bottom-0 left-0 right-0 z-[10]
            + border/shadow card + h-3 spacer
        */}
        {pendingPermission ? (
          <PermissionStickyShell
            promptRef={permissionPromptRef}
            scrollerOverflow={scrollerOverflow}
          >
            <PermissionBubble
              item={pendingPermission}
              onAnswer={session.answer}
            />
          </PermissionStickyShell>
        ) : null}
      </div>

      {explainer ? (
        <ProductExplainer
          kind={explainer}
          onClose={() => {
            if (explainer === 'pairing') {
              void patchOnboarding({ pairingExplainerSeen: true }).then(setOnboarding);
            }
            setExplainer(null);
          }}
        />
      ) : null}

      {/* Official in-panel PairingPrompt overlay (show_pairing_prompt). */}
      {pairingPrompt ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-sm">
            <PairingPrompt
              requestId={pairingPrompt.requestId}
              clientType={pairingPrompt.clientType}
              currentName={pairingPrompt.currentName}
              onConfirm={(id, name) => {
                void chrome.runtime.sendMessage({
                  type: 'pairing_confirmed',
                  request_id: id,
                  name,
                });
                setPairingPrompt(null);
              }}
              onDismiss={(id) => {
                void chrome.runtime.sendMessage({
                  type: 'pairing_dismissed',
                  request_id: id,
                });
                setPairingPrompt(null);
              }}
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}

