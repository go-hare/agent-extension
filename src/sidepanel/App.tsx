/**
 * 侧栏根组件。
 *
 * 外壳 className 逐字取自原版的 React root：
 *   flex flex-col h-screen bg-bg-100     data-theme="claude"
 *
 * 首次打开顺序（对齐官方）：
 *   1. Before you start（风险确认，一次）
 *   2. 空对话时 Pin Claude tip（一次）
 *   3. 正常 EmptyState / transcript
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Composer, type SlashCommand } from './components/Composer';
import { EmptyState } from './components/EmptyState';
import { Header } from './components/Header';
import { TodoList } from './components/TodoList';
import { Transcript } from './components/Transcript';
import { BeforeYouStart } from './components/BeforeYouStart';
import { PinOnboarding } from './components/PinOnboarding';
import { ProductExplainer, type ExplainerKind } from './components/ProductExplainer';
import { SkipModeBorder } from './components/SkipModeBorder';
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
import { createSchedule } from '@/scheduling/store';

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

  useEffect(() => subscribeTodos(setTodosState), []);

  useEffect(() => {
    void loadOnboarding().then(setOnboarding);
  }, []);

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
      void patchSettings({ locale });
    },
    [patchSettings],
  );

  const onClear = useCallback(() => {
    session.reset();
    clearTodos();
  }, [session]);

  /**
   * Official FZ “Convert to task”: turn the current chat into a Scheduled entry.
   * Full official path asks the model for XML (title/prompt/frequency/url);
   * our MVP seeds Options → Scheduled from the last user turn so the menu
   * works end-to-end without a separate conversion surface.
   */
  const onConvertToTask = useCallback(async () => {
    if (session.running) return;
    const users = session.items.filter((i) => i.kind === 'user');
    if (users.length === 0) return;

    const last = users[users.length - 1]!;
    const raw = last.text.replace(/\s+/g, ' ').trim();
    if (!raw) return;

    const title = (raw.length > 50 ? `${raw.slice(0, 47)}…` : raw) || 'Converted task';
    // Prefer the final user instruction; earlier turns are often setup/noise.
    await createSchedule({
      title,
      prompt: raw,
      everyMinutes: 24 * 60, // daily — closest to official recurring default
      tabUrl: session.tab?.url,
    });
    // Land in Options so the user can edit cadence / pause / delete.
    void chrome.runtime.openOptionsPage();
  }, [session.items, session.running, session.tab?.url]);

  const finishBeforeYouStart = useCallback(() => {
    void patchOnboarding({ beforeYouStartDone: true }).then(setOnboarding);
  }, []);

  const dismissPin = useCallback(() => {
    void patchOnboarding({ pinTipShown: true }).then(setOnboarding);
  }, []);

  const configured = hasUsableCredentials(settings);
  const empty = session.items.length === 0;

  // Official: Working/status lives in-transcript (StatusPill), not above the composer.
  const statusText = session.awaitingPermission
    ? t.waitingForPermission
    : t.working;

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
        id: 'record-workflow',
        label: t.teachClaude,
        description: t.teachSlashDesc,
        run: openTeach,
      },
      {
        id: 'teach',
        label: t.teachClaude,
        description: t.teachSlashDesc,
        run: openTeach,
      },
      {
        id: 'cowork',
        label: t.claudeCowork,
        description: 'About the official Cowork side panel vs this classic agent.',
        run: () => setExplainer('cowork'),
      },
      {
        id: 'pairing',
        label: t.pairingTitle,
        description: 'About official Desktop pairing (not required here).',
        run: () => setExplainer('pairing'),
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

  // Official pin tip: maxDisplays 1 on empty sidepanel (credentials optional —
  // users still need to discover the toolbar pin before setup).
  const showPin = empty && !onboarding.pinTipShown;

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

      <Transcript
        items={session.items}
        onAnswer={session.answer}
        running={session.running}
        statusText={statusText}
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
    </div>
  );
}

