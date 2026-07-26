/**
 * 侧栏根组件。
 *
 * 外壳 className 逐字取自原版的 React root：
 *   flex flex-col h-screen bg-bg-100     data-theme="claude"
 * 输入框槽位：
 *   sticky bottom-0 mx-auto w-full z-[5]  + 一个 "bg-bg-100 h-0.5" 的垫片
 *
 * 那个 h-0.5 的垫片看起来是废话，其实是必要的：sticky 元素和上面的滚动区
 * 之间在部分缩放比例下会露出 1px 的透明缝，滚动内容会从缝里透出来。
 * 垫片用同色把缝填掉。
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Composer, StatusLine, type SlashCommand } from './components/Composer';
import { EmptyState } from './components/EmptyState';
import { Header } from './components/Header';
import { TodoList } from './components/TodoList';
import { Transcript } from './components/Transcript';
import { useSession } from './state/useSession';
import { clearTodos, getTodos, subscribeTodos } from './state/todos';
import { applyMode, bootstrapTheme, watchSystemMode, type Mode } from './theme';
import { hasUsableCredentials, loadSettings, saveSettings, watchSettings } from '@/storage/settings';
import { DEFAULT_SETTINGS, type Settings } from '@/shared/types';
import type { TodoItem } from './components/TodoList';

export function App() {
  const session = useSession();
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [mode, setMode] = useState<Mode>(() => bootstrapTheme());
  const [todos, setTodosState] = useState<TodoItem[]>(() => getTodos());

  // ── 设置 ──
  //
  // 侧栏在用户改配置时**不重载**，所以必须订阅 storage 变化，
  // 否则用户在配置页填完 key 回到侧栏，这里还以为没配。
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

  useEffect(() => subscribeTodos(setTodosState), []);

  // system 模式下跟随系统。非 system 时这个订阅是无害的空转，
  // 但保留它可以避免在 mode 变化时反复装卸监听器。
  useEffect(() => {
    return watchSystemMode(() => {
      if (mode === 'system') applyMode('system');
    });
  }, [mode]);

  const openOptions = useCallback(() => {
    void chrome.runtime.openOptionsPage();
  }, []);

  const patchSettings = useCallback(async (patch: Partial<Settings>) => {
    const next = await saveSettings(patch);
    setSettings(next);
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

  const onClear = useCallback(() => {
    session.reset();
    clearTodos();
  }, [session]);

  const configured = hasUsableCredentials(settings);
  const empty = session.items.length === 0;

  // 步数 = 已发起的工具调用数。给用户一个"它到底干了多少事"的量感 ——
  // 只有一个转圈动画的话，跑 30 秒和跑 3 分钟看起来一模一样。
  const steps = session.items.filter((i) => i.kind === 'tool').length;

  const status = session.awaitingPermission ? 'Waiting for your answer' : 'Working';

  const send = session.send;
  const commands = useMemo<SlashCommand[]>(
    () => [
      {
        id: 'clear',
        label: 'Clear chat',
        description: 'Start a new conversation and clear the checklist.',
        run: onClear,
      },
      {
        id: 'settings',
        label: 'Settings',
        description: 'Open the extension options page.',
        run: openOptions,
      },
      {
        id: 'summarize',
        label: 'Summarize page',
        description: 'Insert a prompt to summarize the current page.',
        insert: 'Summarize this page',
      },
      {
        id: 'find',
        label: 'Find on page',
        description: 'Insert a prompt to locate something on this site.',
        insert: 'Find the pricing on this site',
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
    ],
    [onClear, openOptions, send],
  );

  return (
    <div data-theme="claude" className="flex flex-col h-screen bg-bg-100">
      <Header
        model={settings.model}
        availableModels={settings.availableModels}
        tabTitle={session.tab?.title}
        tabUrl={session.tab?.url}
        canClear={!empty || todos.length > 0}
        onClear={onClear}
        onOpenOptions={openOptions}
        onSelectModel={onSelectModel}
      />

      <TodoList items={todos} />

      <Transcript items={session.items} onAnswer={session.answer}>
        <EmptyState configured={configured} onPick={session.send} onOpenOptions={openOptions} />
      </Transcript>

      <div className="sticky bottom-0 mx-auto w-full z-[5]">
        <div className="bg-bg-100 h-0.5" />
        {session.running ? <StatusLine label={status} steps={steps} /> : null}
        <Composer
          empty={empty}
          running={session.running}
          blocked={session.awaitingPermission}
          permissionMode={settings.permissionMode}
          onPermissionModeChange={onPermissionModeChange}
          onSend={session.send}
          onStop={session.stop}
          commands={commands}
        />
        {/*
          用量。放在最下面而不是头部：它是事后信息，不该和"现在能不能操作"
          这类状态抢注意力。0 token 时整行不渲染，避免空对话时出现一行 "0 in".
        */}
        <div className="flex items-center justify-center gap-2 px-4 py-1.5">
          {session.usage.inputTokens + session.usage.outputTokens > 0 ? (
            <span className="font-small text-[0.6875rem] text-text-500">
              {fmt(session.usage.inputTokens)} in · {fmt(session.usage.outputTokens)} out
            </span>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function fmt(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}
