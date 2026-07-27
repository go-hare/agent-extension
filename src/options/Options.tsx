/**
 * 配置页。
 *
 * 三个硬约束，都跟"别帮用户做决定"有关：
 *
 *  1. **API Key 默认不显示。** 用 type="password"，要看得自己点。
 *     配置页可能在共享屏幕的时候被打开。
 *  2. **不预填任何 base/key。** 代码里不带默认中转站地址 ——
 *     那样等于替用户选了一个第三方服务来托管他的对话内容。
 *  3. **Save 是显式的。** 不做 onChange 即存：用户在改 base URL 的过程中
 *     会经过一堆无效中间态（`https://`、`https://re`），边改边存会让
 *     侧栏那边的 peekSettings() 一直看到坏值。
 *
 * 布局用的是和侧栏同一套 token / 字体类，但**不追求和原版 config.html 一致** ——
 * 原版那个页面是给 Anthropic 账号登录用的，本项目根本没有那套东西。
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { cn } from '@/sidepanel/components/cn';
import {
  AlertIcon,
  CheckIcon,
  CloseIcon,
  ShieldIcon,
  SpinnerIcon,
} from '@/sidepanel/components/icons';
import { applyMode } from '@/sidepanel/theme';
import { fetchModels, testConnection } from '@/api/client';
import { permissionManager } from '@/permissions/manager';
import { PERMISSION_LABEL } from '@/permissions/rules';
import { loadSettings, normalizeBaseUrl, saveSettings } from '@/storage/settings';
import { DEFAULT_SETTINGS, type Permission, type Settings } from '@/shared/types';
import {
  deleteShortcut,
  listShortcuts,
  saveShortcut,
  type Shortcut,
} from '@/shortcuts/store';
import {
  createSchedule,
  deleteSchedule,
  listSchedules,
  setScheduleEnabled,
  type Schedule,
} from '@/scheduling/store';
import { UiLocaleProvider, useUi } from '@/i18n/UiLocaleContext';
import { getUiStrings, UI_LOCALES } from '@/i18n/ui';

type Probe =
  | { state: 'idle' }
  | { state: 'busy' }
  | { state: 'ok'; message: string }
  | { state: 'fail'; message: string };

export function Options() {
  const [draft, setDraft] = useState<Settings>(DEFAULT_SETTINGS);
  const [saved, setSaved] = useState<Settings>(DEFAULT_SETTINGS);
  const [showKey, setShowKey] = useState(false);
  const [probe, setProbe] = useState<Probe>({ state: 'idle' });
  const [modelProbe, setModelProbe] = useState<Probe>({ state: 'idle' });
  const [grants, setGrants] = useState<Array<{ host: string; permissions: Permission[] }>>([]);
  const [flash, setFlash] = useState<string | null>(null);
  const [shortcuts, setShortcuts] = useState<Shortcut[]>([]);
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [scDraft, setScDraft] = useState({ command: '', title: '', description: '', prompt: '' });
  const [schDraft, setSchDraft] = useState({ title: '', prompt: '', everyMinutes: '15' });

  useEffect(() => {
    void (async () => {
      const s = await loadSettings();
      setDraft(s);
      setSaved(s);
      applyMode(s.mode);
      document.title = getUiStrings(s.locale).optionsTitle;
      await permissionManager.init();
      setGrants(permissionManager.listGrants());
      setShortcuts(await listShortcuts());
      setSchedules(await listSchedules());
    })();
  }, []);

  useEffect(() => {
    document.title = getUiStrings(draft.locale).optionsTitle;
  }, [draft.locale]);

  const dirty = useMemo(() => JSON.stringify(draft) !== JSON.stringify(saved), [draft, saved]);

  const patch = useCallback(<K extends keyof Settings>(key: K, value: Settings[K]) => {
    setDraft((d) => ({ ...d, [key]: value }));
  }, []);

  const save = useCallback(async () => {
    // base URL 在**保存时**归一化，不在输入时 —— 输入时归一化会把光标
    // 弹到末尾，还会在用户刚敲完 "https:/" 时就补成 "https://https:/"。
    const next: Settings = { ...draft, apiBaseUrl: normalizeBaseUrl(draft.apiBaseUrl) };
    const stored = await saveSettings(next);
    setDraft(stored);
    setSaved(stored);
    applyMode(stored.mode);
    setFlash(getUiStrings(stored.locale).saved);
    window.setTimeout(() => setFlash(null), 2000);
  }, [draft]);

  const revert = useCallback(() => {
    setDraft(saved);
    setProbe({ state: 'idle' });
    setModelProbe({ state: 'idle' });
  }, [saved]);

  /**
   * 测连接。
   *
   * **先保存再测**。理由：testConnection 走 createClient()，而 createClient
   * 读的是 peekSettings()（已保存的值）。不先存就测，测的是旧配置 ——
   * 用户改完 key 点测试，得到"401"，然后怀疑新 key 是坏的。
   */
  const runTest = useCallback(async () => {
    setProbe({ state: 'busy' });
    const next: Settings = { ...draft, apiBaseUrl: normalizeBaseUrl(draft.apiBaseUrl) };
    const stored = await saveSettings(next);
    setDraft(stored);
    setSaved(stored);

    const r = await testConnection();
    setProbe(
      r.ok
        ? { state: 'ok', message: `Reached the relay and ${r.model} answered.` }
        : { state: 'fail', message: r.error },
    );
  }, [draft]);

  const loadModels = useCallback(async () => {
    setModelProbe({ state: 'busy' });
    const next: Settings = { ...draft, apiBaseUrl: normalizeBaseUrl(draft.apiBaseUrl) };
    await saveSettings(next);

    const r = await fetchModels();
    if (r.ok) {
      const stored = await saveSettings({ availableModels: r.models });
      setDraft((d) => ({ ...d, availableModels: r.models }));
      setSaved(stored);
      setModelProbe({ state: 'ok', message: `${r.models.length} models available.` });
    } else {
      setModelProbe({ state: 'fail', message: r.error });
    }
  }, [draft]);

  return (
    <UiLocaleProvider locale={draft.locale}>
      <OptionsBody
        draft={draft}
        saved={saved}
        dirty={dirty}
        showKey={showKey}
        setShowKey={setShowKey}
        probe={probe}
        modelProbe={modelProbe}
        grants={grants}
        setGrants={setGrants}
        flash={flash}
        shortcuts={shortcuts}
        setShortcuts={setShortcuts}
        schedules={schedules}
        setSchedules={setSchedules}
        scDraft={scDraft}
        setScDraft={setScDraft}
        schDraft={schDraft}
        setSchDraft={setSchDraft}
        patch={patch}
        save={save}
        revert={revert}
        runTest={runTest}
        loadModels={loadModels}
      />
    </UiLocaleProvider>
  );
}

function OptionsBody({
  draft,
  dirty,
  showKey,
  setShowKey,
  probe,
  modelProbe,
  grants,
  setGrants,
  flash,
  shortcuts,
  setShortcuts,
  schedules,
  setSchedules,
  scDraft,
  setScDraft,
  schDraft,
  setSchDraft,
  patch,
  save,
  revert,
  runTest,
  loadModels,
}: {
  draft: Settings;
  saved: Settings;
  dirty: boolean;
  showKey: boolean;
  setShowKey: React.Dispatch<React.SetStateAction<boolean>>;
  probe: Probe;
  modelProbe: Probe;
  grants: Array<{ host: string; permissions: Permission[] }>;
  setGrants: React.Dispatch<
    React.SetStateAction<Array<{ host: string; permissions: Permission[] }>>
  >;
  flash: string | null;
  shortcuts: Shortcut[];
  setShortcuts: React.Dispatch<React.SetStateAction<Shortcut[]>>;
  schedules: Schedule[];
  setSchedules: React.Dispatch<React.SetStateAction<Schedule[]>>;
  scDraft: { command: string; title: string; description: string; prompt: string };
  setScDraft: React.Dispatch<
    React.SetStateAction<{ command: string; title: string; description: string; prompt: string }>
  >;
  schDraft: { title: string; prompt: string; everyMinutes: string };
  setSchDraft: React.Dispatch<
    React.SetStateAction<{ title: string; prompt: string; everyMinutes: string }>
  >;
  patch: <K extends keyof Settings>(key: K, value: Settings[K]) => void;
  save: () => Promise<void>;
  revert: () => void;
  runTest: () => Promise<void>;
  loadModels: () => Promise<void>;
}) {
  const t = useUi();

  return (
    <div className="mx-auto max-w-2xl px-6 py-8">
      <h1 className="font-heading mb-1 text-text-100">{t.optionsHeading}</h1>
      <p className="font-base mb-8 text-sm text-text-400">{t.optionsIntro}</p>

      <Section title={t.sectionApi} note={t.sectionApiNote}>
        <Field label="Base URL" hint="e.g. https://relay.example.com">
          <input
            type="url"
            spellCheck={false}
            autoComplete="off"
            placeholder="https://your-relay.example.com"
            value={draft.apiBaseUrl}
            onChange={(e) => patch('apiBaseUrl', e.target.value)}
            className={INPUT}
          />
        </Field>

        <Field label="API key" hint="Stored in chrome.storage.local on this device only.">
          <div className="flex gap-2">
            <input
              type={showKey ? 'text' : 'password'}
              spellCheck={false}
              autoComplete="off"
              placeholder="sk-…"
              value={draft.apiKey}
              onChange={(e) => patch('apiKey', e.target.value)}
              className={INPUT}
            />
            <button type="button" onClick={() => setShowKey((v) => !v)} className={BTN_GHOST}>
              {showKey ? 'Hide' : 'Show'}
            </button>
          </div>
        </Field>

        <Field label="Model" hint="Type a name, or load the list if your relay implements /v1/models.">
          <div className="flex gap-2">
            <input
              type="text"
              spellCheck={false}
              autoComplete="off"
              list="model-list"
              placeholder="claude-sonnet-4-6"
              value={draft.model}
              onChange={(e) => patch('model', e.target.value)}
              className={INPUT}
            />
            <datalist id="model-list">
              {draft.availableModels.map((m) => (
                <option key={m} value={m} />
              ))}
            </datalist>
            <button
              type="button"
              onClick={() => void loadModels()}
              disabled={modelProbe.state === 'busy'}
              className={BTN_GHOST}
            >
              {modelProbe.state === 'busy' ? 'Loading…' : 'Load list'}
            </button>
          </div>
          <ProbeLine probe={modelProbe} />
        </Field>

        <Field
          label="Max tokens per reply"
          hint="Lower this if your relay rejects the request with a max_tokens error."
        >
          <input
            type="number"
            min={256}
            max={64000}
            step={256}
            value={draft.maxTokens}
            onChange={(e) => patch('maxTokens', clampInt(e.target.value, 256, 64000, 8192))}
            className={cn(INPUT, 'max-w-[10rem]')}
          />
        </Field>

        <div className="flex items-center gap-3 pt-1">
          <button
            type="button"
            onClick={() => void runTest()}
            disabled={probe.state === 'busy' || !draft.apiBaseUrl || !draft.apiKey}
            className={BTN_PRIMARY}
          >
            {probe.state === 'busy' ? (
              <>
                <SpinnerIcon size={14} className="animate-spin" />
                Testing…
              </>
            ) : (
              'Save & test connection'
            )}
          </button>
        </div>
        <ProbeLine probe={probe} />
      </Section>

      <Section title={t.sectionWhere} note={t.sectionWhereNote}>
        <Field
          label="Only these sites"
          hint="One host per line. Subdomains are included automatically."
        >
          <textarea
            rows={3}
            spellCheck={false}
            placeholder="example.com"
            value={draft.allowedDomains.join('\n')}
            onChange={(e) => patch('allowedDomains', splitHosts(e.target.value))}
            className={cn(INPUT, 'font-mono text-xs')}
          />
        </Field>

        <Field label="Never these sites" hint="Checked before any stored permission.">
          <textarea
            rows={3}
            spellCheck={false}
            placeholder="mail.google.com"
            value={draft.deniedDomains.join('\n')}
            onChange={(e) => patch('deniedDomains', splitHosts(e.target.value))}
            className={cn(INPUT, 'font-mono text-xs')}
          />
        </Field>

        <Field
          label="Default permission mode"
          hint="Also switchable from the side-panel composer. “Act without asking” still forces a prompt for irreversible actions, money/login sites, JavaScript, and plan approval."
        >
          <div className="flex gap-2">
            {(
              [
                { id: 'ask' as const, label: t.askBeforeActing },
                { id: 'skip' as const, label: t.actWithoutAsking },
              ] as const
            ).map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => patch('permissionMode', opt.id)}
                className={cn(
                  'font-base h-9 min-w-[75px] rounded-lg border-[0.5px] px-[14px] py-[3px] transition-colors',
                  draft.permissionMode === opt.id
                    ? 'border-text-000 bg-text-000 text-bg-000'
                    : 'border-border-200 text-text-100 hover:bg-bg-100',
                )}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </Field>

        <Toggle
          checked={draft.forcePrompt}
          onChange={(v) => patch('forcePrompt', v)}
          label="Ask before every single action"
          hint="Ignores stored permissions and the “Act without asking” mode. Slow, but nothing happens without you seeing it."
        />
      </Section>

      <Section title={t.sectionCapabilities}>
        <Toggle
          checked={draft.enableJavascriptTool}
          onChange={(v) => patch('enableJavascriptTool', v)}
          label="Allow running JavaScript on pages"
          hint="Off by default. Arbitrary JS can read anything on the page, including a logged-in session. This permission can never be granted permanently."
          danger
        />
        <Toggle
          checked={draft.enableBrowserBatch}
          onChange={(v) => patch('enableBrowserBatch', v)}
          label="Allow batching several actions into one call"
          hint="Faster multi-step calls. Steps that still need a first-time permission grant will fail inside a batch — approve those tools once standalone, then batch the rest."
        />
        <Toggle
          checked={draft.soundEnabled}
          onChange={(v) => patch('soundEnabled', v)}
          label="Play a sound when the agent needs you"
          hint="Useful when the side panel is not focused."
        />
      </Section>

      <Section title={t.sectionAppearance}>
        <Field label={t.theme}>
          <div className="flex gap-2">
            {(['light', 'dark', 'system'] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => {
                  patch('mode', m);
                  applyMode(m);
                }}
                className={cn(
                  'font-base h-9 min-w-[75px] rounded-lg border-[0.5px] px-[14px] py-[3px] transition-colors',
                  draft.mode === m
                    ? 'border-border-400 bg-bg-300 text-text-100'
                    : 'border-border-200 text-text-100 hover:bg-bg-100',
                )}
              >
                {m[0]?.toUpperCase()}
                {m.slice(1)}
              </button>
            ))}
          </div>
        </Field>

        <Field label={t.language} hint={t.languageHint}>
          <select
            value={draft.locale}
            onChange={(e) => patch('locale', e.target.value as Settings['locale'])}
            className={cn(INPUT, 'max-w-[18rem]')}
          >
            {UI_LOCALES.map((opt) => (
              <option key={opt.id} value={opt.id}>
                {opt.label}
              </option>
            ))}
          </select>
        </Field>
      </Section>

      <Section title={t.sectionTeach} note={t.sectionTeachNote}>
        <Toggle
          checked={draft.teachSpeechEnabled}
          onChange={(v) => patch('teachSpeechEnabled', v)}
          label={t.teachSpeechEnable}
          hint={t.teachSpeechEnableHint}
        />
        <Field label={t.teachSpeechLangLabel} hint={t.teachSpeechLangHint}>
          <input
            type="text"
            spellCheck={false}
            autoComplete="off"
            placeholder={draft.locale}
            value={draft.teachSpeechLang}
            onChange={(e) => patch('teachSpeechLang', e.target.value.trim())}
            className={cn(INPUT, 'max-w-[12rem]')}
          />
        </Field>
        <Toggle
          checked={draft.teachCaptureFrames}
          onChange={(v) => patch('teachCaptureFrames', v)}
          label={t.teachCaptureFramesLabel}
          hint={t.teachCaptureFramesHint}
        />
      </Section>

      <Section title={t.sectionPermissions} note={t.sectionPermissionsNote}>
        {grants.length === 0 ? (
          <p className="font-base flex items-center gap-2 text-sm text-text-400">
            <ShieldIcon size={14} />
            Nothing is remembered yet.
          </p>
        ) : (
          <div className="space-y-1.5">
            {grants.map((g) => (
              <div
                key={g.host}
                className="flex items-start justify-between gap-3 rounded-lg border-[0.5px] border-border-300 bg-bg-000 px-3 py-2"
              >
                <div className="min-w-0">
                  <div className="font-base truncate text-sm text-text-100">{g.host}</div>
                  <div className="font-small text-[0.6875rem] text-text-500">
                    {g.permissions.map((p) => PERMISSION_LABEL[p] ?? p).join(' · ')}
                  </div>
                </div>
                <button
                  type="button"
                  aria-label={`Revoke permissions for ${g.host}`}
                  onClick={() => {
                    void permissionManager.revokeHost(g.host).then(() => {
                      setGrants(permissionManager.listGrants());
                    });
                  }}
                  className="shrink-0 rounded-md p-1.5 text-text-300 transition-colors hover:bg-bg-300 hover:text-danger-100"
                >
                  <CloseIcon size={14} />
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={() => {
                void permissionManager.revokeAll().then(() => setGrants([]));
              }}
              className={cn(BTN_GHOST, 'mt-2')}
            >
              Revoke all
            </button>
          </div>
        )}
      </Section>

      <Section title={t.sectionShortcuts} note={t.sectionShortcutsNote}>
        <div className="space-y-2">
          {shortcuts.map((s) => (
            <div
              key={s.id}
              className="flex items-start justify-between gap-3 rounded-lg border-[0.5px] border-border-300 bg-bg-000 px-3 py-2"
            >
              <div className="min-w-0">
                <div className="font-base text-sm text-text-100">
                  /{s.command} · {s.title}
                </div>
                <div className="font-small text-[0.6875rem] text-text-500">{s.description}</div>
              </div>
              <button
                type="button"
                aria-label={`Delete shortcut ${s.command}`}
                onClick={() => {
                  void deleteShortcut(s.id).then(async () => setShortcuts(await listShortcuts()));
                }}
                className="shrink-0 rounded-md p-1.5 text-text-300 transition-colors hover:bg-bg-300 hover:text-danger-100"
              >
                <CloseIcon size={14} />
              </button>
            </div>
          ))}
        </div>
        <div className="mt-3 space-y-2 rounded-lg border-[0.5px] border-border-300 bg-bg-000 p-3">
          <div className="font-base-bold text-sm text-text-100">Add shortcut</div>
          <input
            className={INPUT}
            placeholder="command (e.g. summarize)"
            value={scDraft.command}
            onChange={(e) => setScDraft((d) => ({ ...d, command: e.target.value }))}
          />
          <input
            className={INPUT}
            placeholder="Title"
            value={scDraft.title}
            onChange={(e) => setScDraft((d) => ({ ...d, title: e.target.value }))}
          />
          <input
            className={INPUT}
            placeholder="Short description"
            value={scDraft.description}
            onChange={(e) => setScDraft((d) => ({ ...d, description: e.target.value }))}
          />
          <textarea
            className={cn(INPUT, 'min-h-[4.5rem]')}
            placeholder="Prompt body sent to the agent"
            value={scDraft.prompt}
            onChange={(e) => setScDraft((d) => ({ ...d, prompt: e.target.value }))}
          />
          <button
            type="button"
            className={BTN_GHOST}
            disabled={!scDraft.command.trim() || !scDraft.prompt.trim()}
            onClick={() => {
              void saveShortcut({
                command: scDraft.command,
                title: scDraft.title || scDraft.command,
                description: scDraft.description || scDraft.title || scDraft.command,
                prompt: scDraft.prompt,
              }).then(async () => {
                setScDraft({ command: '', title: '', description: '', prompt: '' });
                setShortcuts(await listShortcuts());
              });
            }}
          >
            Save shortcut
          </button>
        </div>
      </Section>

      <Section title={t.sectionSchedules} note={t.sectionSchedulesNote}>
        <div className="space-y-2">
          {schedules.length === 0 ? (
            <p className="font-base text-sm text-text-400">No schedules yet.</p>
          ) : (
            schedules.map((s) => (
              <div
                key={s.id}
                className="flex items-start justify-between gap-3 rounded-lg border-[0.5px] border-border-300 bg-bg-000 px-3 py-2"
              >
                <div className="min-w-0">
                  <div className="font-base text-sm text-text-100">
                    {s.title} · every {s.everyMinutes} min {s.enabled ? '' : '(paused)'}
                  </div>
                  <div className="font-small line-clamp-2 text-[0.6875rem] text-text-500">
                    {s.prompt}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <button
                    type="button"
                    className={BTN_GHOST}
                    onClick={() => {
                      void setScheduleEnabled(s.id, !s.enabled).then(async () =>
                        setSchedules(await listSchedules()),
                      );
                    }}
                  >
                    {s.enabled ? 'Pause' : 'Resume'}
                  </button>
                  <button
                    type="button"
                    aria-label={`Delete schedule ${s.title}`}
                    onClick={() => {
                      void deleteSchedule(s.id).then(async () => setSchedules(await listSchedules()));
                    }}
                    className="rounded-md p-1.5 text-text-300 transition-colors hover:bg-bg-300 hover:text-danger-100"
                  >
                    <CloseIcon size={14} />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
        <div className="mt-3 space-y-2 rounded-lg border-[0.5px] border-border-300 bg-bg-000 p-3">
          <div className="font-base-bold text-sm text-text-100">Add schedule</div>
          <input
            className={INPUT}
            placeholder="Title"
            value={schDraft.title}
            onChange={(e) => setSchDraft((d) => ({ ...d, title: e.target.value }))}
          />
          <input
            className={INPUT}
            placeholder="Every N minutes (min 1)"
            value={schDraft.everyMinutes}
            onChange={(e) => setSchDraft((d) => ({ ...d, everyMinutes: e.target.value }))}
          />
          <textarea
            className={cn(INPUT, 'min-h-[4.5rem]')}
            placeholder="Prompt to run when the side panel is open"
            value={schDraft.prompt}
            onChange={(e) => setSchDraft((d) => ({ ...d, prompt: e.target.value }))}
          />
          <button
            type="button"
            className={BTN_GHOST}
            disabled={!schDraft.title.trim() || !schDraft.prompt.trim()}
            onClick={() => {
              const mins = clampInt(schDraft.everyMinutes, 1, 24 * 60, 15);
              void createSchedule({
                title: schDraft.title.trim(),
                prompt: schDraft.prompt.trim(),
                everyMinutes: mins,
              }).then(async () => {
                setSchDraft({ title: '', prompt: '', everyMinutes: '15' });
                setSchedules(await listSchedules());
              });
            }}
          >
            Create schedule
          </button>
        </div>
      </Section>

      {/*
        保存条固定在底部。
        长表单里把 Save 放在页尾意味着用户改了顶部的一个开关后要滚到底 ——
        滚动过程中很容易忘了自己改了什么。
      */}
      <div className="sticky bottom-0 -mx-6 mt-8 border-t-[0.5px] border-border-300 bg-bg-100/95 px-6 py-3 backdrop-blur">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => void save()}
            disabled={!dirty}
            className={BTN_PRIMARY}
          >
            {t.saveChanges}
          </button>
          {dirty ? (
            <button type="button" onClick={revert} className={BTN_GHOST}>
              {t.discard}
            </button>
          ) : null}
          {flash ? (
            <span className="font-small flex items-center gap-1.5 text-sm text-success-100">
              <CheckIcon size={14} />
              {flash}
            </span>
          ) : null}
          {dirty && !flash ? (
            <span className="font-small text-sm text-text-400">{t.unsaved}</span>
          ) : null}
        </div>
      </div>
    </div>
  );
}

// ───────────────────────── 布局零件 ─────────────────────────

const INPUT =
  'font-base w-full rounded-lg border-[0.5px] border-border-200 bg-bg-000 px-3 py-2 text-sm text-text-100 placeholder:text-text-500 transition-colors focus:border-border-400 focus:outline-none';

const BTN_PRIMARY =
  'inline-flex items-center justify-center gap-1.5 relative shrink-0 select-none disabled:pointer-events-none disabled:opacity-50 font-medium transition-colors h-9 rounded-lg px-4 active:scale-95 bg-brand-000 hover:bg-brand-200 text-oncolor-100 text-sm';

const BTN_GHOST =
  'inline-flex items-center justify-center gap-1.5 shrink-0 select-none font-medium transition-colors h-9 shrink-0 rounded-lg border-[0.5px] border-border-200 px-3 text-sm text-text-100 hover:bg-bg-200 disabled:pointer-events-none disabled:opacity-50';

function Section({
  title,
  note,
  children,
}: {
  title: string;
  note?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-10">
      <h2 className="font-large-bold mb-1 text-text-100">{title}</h2>
      {note ? <p className="font-base mb-4 text-sm text-text-400">{note}</p> : null}
      <div className="space-y-4">{children}</div>
    </section>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="font-base-bold mb-1 block text-sm text-text-100">{label}</span>
      {children}
      {hint ? <span className="font-small mt-1 block text-[0.75rem] text-text-500">{hint}</span> : null}
    </label>
  );
}

function Toggle({
  checked,
  onChange,
  label,
  hint,
  danger,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  hint?: string;
  danger?: boolean;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-3">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 size-4 shrink-0 accent-[hsl(var(--brand-000))]"
      />
      <span className="min-w-0">
        <span
          className={cn(
            'font-base block text-sm',
            danger && checked ? 'text-danger-100' : 'text-text-100',
          )}
        >
          {label}
        </span>
        {hint ? (
          <span className="font-small mt-0.5 block text-[0.75rem] text-text-500">{hint}</span>
        ) : null}
      </span>
    </label>
  );
}

function ProbeLine({ probe }: { probe: Probe }) {
  if (probe.state === 'idle' || probe.state === 'busy') return null;
  const ok = probe.state === 'ok';
  return (
    <p
      className={cn(
        'font-small mt-2 flex items-start gap-1.5 text-[0.8125rem]',
        ok ? 'text-success-100' : 'text-danger-100',
      )}
    >
      {ok ? (
        <CheckIcon size={14} className="mt-0.5 shrink-0" />
      ) : (
        <AlertIcon size={14} className="mt-0.5 shrink-0" />
      )}
      {/* 中转站的报错文本直接来自远端，纯文本渲染，不给它任何富文本能力。 */}
      <span className="min-w-0 break-words">{probe.message}</span>
    </p>
  );
}

// ───────────────────────── 工具 ─────────────────────────

/**
 * 把多行文本切成 host 列表。
 *
 * 有意接受用户粘一整个 URL：大部分人是从地址栏复制的。
 * 取 hostname 而不是原样存，否则 hostMatches 永远匹配不上。
 */
function splitHosts(raw: string): string[] {
  return raw
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      if (!/^https?:\/\//i.test(s)) {
        // 裸 host 可能带路径（example.com/foo），只留 host 部分
        return s.split('/')[0]?.toLowerCase() ?? '';
      }
      try {
        return new URL(s).hostname.toLowerCase();
      } catch {
        return s.toLowerCase();
      }
    })
    .filter(Boolean);
}

function clampInt(raw: string, min: number, max: number, fallback: number): number {
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}
