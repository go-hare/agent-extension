/**
 * Official "Teach Claude" / Record workflow (nG + tG + eG).
 *
 * Capture path matches Claude in Chrome 1.0.81:
 *   injectElementSelector → ELEMENT_SELECTION → screenshot + blue circle
 *   → KEYSTROKE_UPDATE type steps → LLM enhance / summary on save
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { cn } from './cn';
import {
  CloseIcon,
  ListChecks,
  MicIcon,
  MousePointerClick,
  PauseIcon,
  PlayIcon,
  SpinnerIcon,
} from './icons';
import { useUi } from '@/i18n/UiLocaleContext';
import {
  buildWorkflowPrompt,
  slugCommand,
  type WorkflowRecordingMeta,
  type WorkflowStep,
} from '@/workflow/types';
import { generateWorkflowSummary } from '@/workflow/enhance';
import { RecordingSession } from '@/workflow/recordingSession';
import { saveShortcut } from '@/shortcuts/store';
import { peekSettings } from '@/storage/settings';
import { resolveActiveBrowserTab } from '@/tabs/activeTab';

export type TeachPhase = 'intro' | 'recording' | 'review';

export interface TeachClaudeProps {
  phase: TeachPhase;
  tabTitle?: string;
  tabUrl?: string;
  tabId?: number;
  onPhase: (p: TeachPhase) => void;
  onClose: () => void;
  /** After save, optionally start a turn with the prompt. */
  onSaved?: (prompt: string, meta: { command: string; title: string }) => void;
}

/** Step screenshot zoom (official ZC, simplified). */
function StepShot({
  screenshot,
  click,
  viewport,
}: {
  screenshot: string;
  click?: { x: number; y: number };
  viewport?: { width: number; height: number };
}) {
  const origin = useMemo(() => {
    if (!click || !viewport?.width || !viewport?.height) return '50% 50%';
    const x = Math.min(100, Math.max(0, (click.x / viewport.width) * 100));
    const y = Math.min(100, Math.max(0, (click.y / viewport.height) * 100));
    return `${x}% ${y}%`;
  }, [click, viewport]);

  return (
    <div className="relative w-full h-48 overflow-hidden rounded-xl border-[0.5px] border-border-200 bg-bg-200">
      <img
        src={`data:image/jpeg;base64,${screenshot}`}
        alt=""
        className="w-full h-full object-cover transition-transform duration-500 ease-out"
        style={{ transform: 'scale(2.5)', transformOrigin: origin }}
      />
    </div>
  );
}

export function TeachClaude({
  phase,
  tabTitle,
  tabUrl,
  tabId,
  onPhase,
  onClose,
  onSaved,
}: TeachClaudeProps) {
  const t = useUi();
  const [steps, setSteps] = useState<WorkflowStep[]>([]);
  const [paused, setPaused] = useState(false);
  const [title, setTitle] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const metaRef = useRef<WorkflowRecordingMeta>({ startedAt: Date.now() });
  const sessionRef = useRef<RecordingSession | null>(null);
  const speechRef = useRef<BrowserSpeechRecognition | null>(null);
  const [speechOn, setSpeechOn] = useState(false);
  const [interim, setInterim] = useState('');
  const speechSegmentsRef = useRef<{ text: string; timestamp: number }[]>([]);
  const [micGranted, setMicGranted] = useState<boolean | null>(null);
  const [displayTitle, setDisplayTitle] = useState(tabTitle || '');
  const [displayUrl, setDisplayUrl] = useState(tabUrl || '');
  const [summaryPrompt, setSummaryPrompt] = useState<string | null>(null);

  const speechSupported =
    typeof window !== 'undefined' &&
    ('SpeechRecognition' in window || 'webkitSpeechRecognition' in window);

  // Mic permission (official intro gate). Re-check when user returns from Options.
  const refreshMicPermission = useCallback(async () => {
    try {
      const st = await navigator.permissions.query({
        name: 'microphone' as PermissionName,
      });
      setMicGranted(st.state === 'granted');
      return st.state === 'granted';
    } catch {
      // permissions.query may fail; treat as unknown → not blocking forever
      setMicGranted((prev) => (prev === true ? true : false));
      return false;
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    let permStatus: PermissionStatus | null = null;
    void (async () => {
      try {
        const st = await navigator.permissions.query({
          name: 'microphone' as PermissionName,
        });
        if (cancelled) return;
        permStatus = st;
        setMicGranted(st.state === 'granted');
        st.addEventListener('change', () => {
          if (!cancelled) setMicGranted(st.state === 'granted');
        });
      } catch {
        if (!cancelled) setMicGranted(false);
      }
    })();

    const onVis = () => {
      if (document.visibilityState === 'visible') void refreshMicPermission();
    };
    const onFocus = () => {
      void refreshMicPermission();
    };
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('focus', onFocus);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('focus', onFocus);
      // PermissionStatus.onchange cleanup is best-effort; listener above uses closed-over cancelled
      void permStatus;
    };
  }, [refreshMicPermission]);

  const hostLabel = (() => {
    try {
      return displayUrl ? new URL(displayUrl).hostname : '';
    } catch {
      return '';
    }
  })();

  const favicon = hostLabel
    ? `https://www.google.com/s2/favicons?domain=${hostLabel}&sz=32`
    : '';

  const stopSpeech = useCallback(() => {
    try {
      speechRef.current?.stop();
    } catch {
      /* ignore */
    }
    speechRef.current = null;
    setSpeechOn(false);
    setInterim('');
  }, []);

  const getSpeechSince = useCallback((sinceTs: number) => {
    const segs = speechSegmentsRef.current.filter((s) => s.timestamp >= sinceTs);
    const text = segs
      .map((s) => s.text)
      .join(' ')
      .trim();
    return text || undefined;
  }, []);

  const startSpeech = useCallback(() => {
    const w = window as Window & {
      SpeechRecognition?: BrowserSpeechRecognitionCtor;
      webkitSpeechRecognition?: BrowserSpeechRecognitionCtor;
    };
    const SR = w.SpeechRecognition || w.webkitSpeechRecognition;
    if (!SR) {
      setError(t.teachSpeechUnsupported);
      return false;
    }
    const rec = new SR();
    rec.continuous = true;
    rec.interimResults = true;
    const st = peekSettings();
    rec.lang = st.teachSpeechLang || st.locale || '';
    rec.onresult = (ev: BrowserSpeechRecognitionEvent) => {
      let interimText = '';
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const r = ev.results[i];
        if (!r) continue;
        const piece = r[0]?.transcript ?? '';
        if (r.isFinal) {
          const text = piece.trim();
          if (text) {
            speechSegmentsRef.current.push({ text, timestamp: Date.now() });
          }
        } else {
          interimText += piece;
        }
      }
      setInterim(interimText.trim());
    };
    rec.onerror = () => setSpeechOn(false);
    try {
      rec.start();
      speechRef.current = rec;
      setSpeechOn(true);
      setError(null);
      return true;
    } catch {
      setError(t.teachSpeechUnsupported);
      return false;
    }
  }, [t.teachSpeechUnsupported]);

  const toggleSpeech = useCallback(() => {
    if (speechOn) {
      stopSpeech();
      return;
    }
    void startSpeech();
  }, [speechOn, startSpeech, stopSpeech]);

  /**
   * Official path: open Options with #permissions?requestMicrophone=true
   * so getUserMedia runs on an extension page (sidepanel prompts are flaky).
   * Also try getUserMedia here first — if it works, no need to leave.
   */
  const requestMic = useCallback(async () => {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((tr) => tr.stop());
      const granted = await refreshMicPermission();
      if (granted) {
        setMicGranted(true);
        return;
      }
      // "Allow this time" may not stick in permissions.query
      setError(t.teachMicAllowHint);
      setMicGranted(true); // allow Start recording this session
      return;
    } catch (e) {
      // Fall through to Options page (official nG handler)
      const name = e instanceof DOMException ? e.name : '';
      if (name === 'NotFoundError') {
        setError(t.teachSpeechUnsupported);
        // No mic hardware — don't block recording
        setMicGranted(true);
        return;
      }
    }

    const optionsUrl = chrome.runtime.getURL(
      'src/options/index.html#permissions?requestMicrophone=true',
    );
    try {
      await chrome.tabs.create({ url: optionsUrl });
    } catch {
      void chrome.runtime.openOptionsPage();
    }
    setError(null);
  }, [refreshMicPermission, t.teachMicAllowHint, t.teachSpeechUnsupported]);

  const startRecording = useCallback(async () => {
    setError(null);
    setSteps([]);
    setPaused(false);
    setSummaryPrompt(null);
    speechSegmentsRef.current = [];

    let target = await resolveActiveBrowserTab();
    if (!target && tabId !== undefined) {
      target = {
        id: tabId,
        windowId: 0,
        url: tabUrl ?? '',
        title: tabTitle ?? '',
      };
    }
    if (!target) {
      setError(t.teachNeedPage);
      return;
    }

    setDisplayTitle(target.title || tabTitle || '');
    setDisplayUrl(target.url || tabUrl || '');

    const session = new RecordingSession({
      onSteps: setSteps,
      onPausedChange: setPaused,
      onError: (msg) => setError(msg),
      enhance: true,
      getSpeechSince,
    });
    sessionRef.current = session;

    const res = await session.start(target.id);
    if (!res.ok) {
      setError(res.error || t.teachNeedPage);
      sessionRef.current = null;
      return;
    }
    metaRef.current = session.recordingMeta;
    onPhase('recording');

    // Auto speech when mic granted / settings
    if (micGranted && speechSupported && peekSettings().teachSpeechEnabled !== false) {
      void startSpeech();
    }
  }, [
    getSpeechSince,
    micGranted,
    onPhase,
    speechSupported,
    startSpeech,
    t.teachNeedPage,
    tabId,
    tabTitle,
    tabUrl,
  ]);

  const stopRecording = useCallback(async () => {
    stopSpeech();
    const session = sessionRef.current;
    const finalSteps = session ? await session.stop() : steps;
    sessionRef.current = null;
    setSteps(finalSteps);
    setTitle(
      displayTitle
        ? `Workflow: ${displayTitle.slice(0, 40)}`
        : t.teachDefaultTitle,
    );
    onPhase('review');
  }, [displayTitle, onPhase, steps, stopSpeech, t.teachDefaultTitle]);

  const discardRecording = useCallback(async () => {
    stopSpeech();
    if (sessionRef.current) {
      await sessionRef.current.stop();
      sessionRef.current = null;
    }
    setSteps([]);
    setPaused(false);
    setError(null);
    onPhase('intro');
  }, [onPhase, stopSpeech]);

  const togglePause = useCallback(async () => {
    await sessionRef.current?.togglePause();
  }, []);

  const removeStep = (id: string) => {
    // Keep RecordingSession in sync while live; always update local list for review.
    sessionRef.current?.removeStep(id);
    setSteps((prev) => prev.filter((s) => s.id !== id));
  };

  useEffect(() => {
    return () => {
      void sessionRef.current?.stop();
      sessionRef.current = null;
      stopSpeech();
    };
  }, [stopSpeech]);

  const save = async (andRun: boolean) => {
    if (steps.length === 0) {
      setError(t.teachNoSteps);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const name = title.trim() || t.teachDefaultTitle;
      const command = slugCommand(name);

      let prompt = summaryPrompt;
      if (!prompt) {
        const sum = await generateWorkflowSummary(steps, { detailScreenshots: true });
        prompt = sum.prompt || null;
        if (prompt) setSummaryPrompt(prompt);
      }
      if (!prompt) {
        prompt = buildWorkflowPrompt(steps, metaRef.current, name);
      }

      // Persist without bulky screenshots
      const sc = await saveShortcut({
        command,
        title: name,
        description: t.teachShortcutDesc(steps.length),
        prompt,
      });
      onSaved?.(andRun ? prompt : '', { command: sc.command, title: sc.title });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  // ─── intro ───
  if (phase === 'intro') {
    const needMic = speechSupported && micGranted === false;
    return (
      <div className="flex flex-col h-full bg-bg-100">
        <div className="flex items-center justify-between px-4 pt-3 pb-3">
          <div className="flex items-center gap-2 min-w-0">
            {favicon ? (
              <img src={favicon} className="w-4 h-4" alt="" />
            ) : (
              <MousePointerClick size={16} className="text-text-300" />
            )}
            <span className="text-text-200 font-base-sm truncate max-w-[200px]">
              {displayTitle || tabTitle || hostLabel || t.teachClaude}
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-md transition-colors text-text-300 hover:bg-bg-300 hover:text-text-100"
            aria-label={t.cancel}
          >
            <CloseIcon size={12} />
          </button>
        </div>

        <div className="flex-1 flex items-center justify-center px-4">
          <div className="max-w-md w-full flex flex-col items-center text-center space-y-6">
            <div className="w-full flex items-center justify-center">
              <img
                src={chrome.runtime.getURL('public/img/record-workflow-hero.png')}
                alt={t.teachYourWorkflow}
                className="w-[360px] h-auto max-w-full"
              />
            </div>
            <div className="space-y-2">
              <h2 className="font-base-bold text-text-100">{t.teachYourWorkflow}</h2>
              <p className="text-text-300 font-base max-w-[280px] mx-auto">
                {needMic ? t.teachIntroBodyMic : t.teachIntroBody}
              </p>
            </div>
          </div>
        </div>

        <div className="mx-auto mb-3 max-w-3xl w-full px-3">
          <div
            className="bg-bg-000 border-[0.5px] border-border-300 hover:border-border-200 rounded-[14px] relative z-30 transition-colors focus-within:outline-none"
            style={{ boxShadow: '0 4px 20px 0 rgba(0, 0, 0, 0.04)', outline: 'none' }}
          >
            <div className="flex flex-col gap-2 px-3 py-3">
              {error ? (
                <p className="font-small text-danger-100 text-center">{error}</p>
              ) : null}
              {needMic ? (
                <>
                  <button
                    type="button"
                    onClick={() => void requestMic()}
                    className="w-full justify-center flex items-center px-4 py-2.5 rounded-[14px] bg-always-black text-oncolor-100 hover:bg-always-black/90 font-button transition-all"
                  >
                    <span className="inline-block w-2 h-2 rounded-full bg-danger-100 mr-2" />
                    {t.teachEnableMic}
                  </button>
                  <button
                    type="button"
                    onClick={() => void startRecording()}
                    className="w-full justify-center flex items-center px-4 py-2 rounded-[14px] border-[0.5px] border-border-300 text-text-200 hover:bg-bg-200 font-button transition-colors"
                  >
                    {t.teachSkipMic}
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={() => void startRecording()}
                  className="w-full justify-center flex items-center px-4 py-2.5 rounded-[14px] bg-always-black text-oncolor-100 hover:bg-always-black/90 font-button transition-all"
                >
                  <span className="inline-block w-2 h-2 rounded-full bg-danger-100 mr-2" />
                  {t.teachStartRecording}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ─── recording (official tG) ───
  // Header: favicon + page title + close
  // Body: eG step cards (numbered circle, description, optional Tab, screenshot)
  // Footer: 3-icon grid (Discard / Pause|Play / Mic) + primary Done
  if (phase === 'recording') {
    const uniqueTabIds = new Set(
      steps.map((s) => s.tabId).filter((id): id is number => id !== undefined),
    );
    const showTabLine = uniqueTabIds.size > 1;

    return (
      <div className="flex flex-col h-full bg-bg-100">
        {/* Official header: page context, not "Recording + text buttons" */}
        <div className="flex items-center justify-between px-4 pt-3 pb-3">
          <div className="flex items-center gap-2 min-w-0">
            {favicon ? (
              <img src={favicon} className="w-4 h-4 shrink-0" alt="" />
            ) : (
              <MousePointerClick size={16} className="text-text-300 shrink-0" />
            )}
            <span className="text-text-200 font-base-sm truncate max-w-[220px]">
              {displayTitle || tabTitle || hostLabel || t.teachClaude}
            </span>
            {paused ? (
              <span className="shrink-0 font-small text-text-400">· {t.teachPaused}</span>
            ) : (
              <span className="shrink-0 inline-flex items-center gap-1 font-small text-danger-100">
                <span className="w-1.5 h-1.5 rounded-full bg-danger-100 animate-pulse" />
                {t.teachRecording}
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={() => void discardRecording()}
            className="p-1.5 rounded-md transition-colors text-text-300 hover:bg-bg-300 hover:text-text-100"
            aria-label={t.teachDiscard}
          >
            <CloseIcon size={12} />
          </button>
        </div>

        {interim ? (
          <p className="px-4 font-small text-text-400 italic truncate">“{interim}”</p>
        ) : null}
        {speechSupported && micGranted === false && !speechOn ? (
          <div className="mx-3 mb-2 rounded-lg bg-yellow-100 text-yellow-800 px-3 py-2 font-small flex items-center gap-2">
            <button
              type="button"
              className="underline hover:no-underline text-left"
              onClick={() => void requestMic()}
            >
              {t.teachEnableMic}
            </button>
            <span className="opacity-80">{t.teachMicBanner}</span>
          </div>
        ) : null}
        {error ? <p className="px-4 font-small text-danger-100">{error}</p> : null}

        <div className="flex-1 overflow-y-auto px-3 pb-4 space-y-2 min-h-0">
          {steps.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center px-6">
              <ListChecks size={20} className="text-text-400 mb-2" />
              <p className="font-base text-text-300">{t.teachClickHint}</p>
            </div>
          ) : (
            steps.map((s, i) => (
              <div
                key={s.id}
                className="group border-[0.5px] border-border-300 rounded-2xl bg-bg-000/30 overflow-hidden"
              >
                <div className="flex items-start gap-2.5 px-3 py-3">
                  {/* Official eG numbered circle */}
                  <span className="shrink-0 mt-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-bg-300 text-text-300 font-small">
                    {i + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p
                      className={cn(
                        'font-base text-sm text-text-100',
                        s.isEnhancing &&
                          'bg-gradient-to-r from-text-400 via-text-200 to-text-400 bg-clip-text text-transparent animate-pulse',
                      )}
                    >
                      {s.isEnhancing ? t.teachLoading : s.description}
                    </p>
                    {/* Official: no raw CSS selector under description */}
                    {s.speechTranscript ? (
                      <p className="font-small text-text-300 italic mt-1">
                        “{s.speechTranscript}”
                      </p>
                    ) : null}
                    {showTabLine && s.tabId !== undefined ? (
                      <p className="font-small text-text-400 mt-0.5">Tab {s.tabId}</p>
                    ) : null}
                  </div>
                  <button
                    type="button"
                    onClick={() => removeStep(s.id)}
                    className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-bg-200 text-text-400"
                    aria-label={t.cancel}
                  >
                    <CloseIcon size={12} />
                  </button>
                </div>
                {s.screenshot && s.clickPosition ? (
                  <div className="px-3 pb-3">
                    <StepShot
                      screenshot={s.screenshot}
                      click={s.clickPosition}
                      viewport={s.viewportDimensions}
                    />
                  </div>
                ) : s.screenshot ? (
                  <div className="px-3 pb-3">
                    <div className="relative w-full h-48 overflow-hidden rounded-xl border-[0.5px] border-border-200">
                      <img
                        src={`data:image/jpeg;base64,${s.screenshot}`}
                        alt=""
                        className="w-full h-full object-cover"
                      />
                    </div>
                  </div>
                ) : null}
              </div>
            ))
          )}
        </div>

        {/* Official tG bottom bar: 3-icon grid + Done */}
        <div className="mx-auto mb-3 max-w-3xl w-full px-3">
          <div
            className="bg-bg-000 border-[0.5px] border-border-300 rounded-[14px] relative z-30"
            style={{ boxShadow: '0 4px 20px 0 rgba(0, 0, 0, 0.04)' }}
          >
            <div className="flex flex-col gap-2 px-3 py-3">
              <div className="grid grid-cols-3 gap-1">
                <button
                  type="button"
                  onClick={() => void discardRecording()}
                  className="flex flex-col items-center justify-center gap-1 py-2 rounded-xl text-text-300 hover:bg-bg-200 hover:text-text-100 transition-colors"
                  title={t.teachDiscard}
                  aria-label={t.teachDiscard}
                >
                  <CloseIcon size={16} />
                  <span className="font-small">{t.teachDiscard}</span>
                </button>
                <button
                  type="button"
                  onClick={() => void togglePause()}
                  className="flex flex-col items-center justify-center gap-1 py-2 rounded-xl text-text-300 hover:bg-bg-200 hover:text-text-100 transition-colors"
                  title={paused ? t.teachResume : t.teachPause}
                  aria-label={paused ? t.teachResume : t.teachPause}
                >
                  {paused ? <PlayIcon size={16} /> : <PauseIcon size={16} />}
                  <span className="font-small">{paused ? t.teachResume : t.teachPause}</span>
                </button>
                <button
                  type="button"
                  onClick={toggleSpeech}
                  className={cn(
                    'flex flex-col items-center justify-center gap-1 py-2 rounded-xl transition-colors',
                    speechOn
                      ? 'text-brand-100 bg-brand-100/10 hover:bg-brand-100/15'
                      : 'text-text-300 hover:bg-bg-200 hover:text-text-100',
                  )}
                  title={speechOn ? t.teachVoiceOn : t.teachVoice}
                  aria-label={speechOn ? t.teachVoiceOn : t.teachVoice}
                >
                  <MicIcon size={16} />
                  <span className="font-small">{speechOn ? t.teachVoiceOn : t.teachVoice}</span>
                </button>
              </div>
              <button
                type="button"
                onClick={() => void stopRecording()}
                className="w-full justify-center flex items-center px-4 py-2.5 rounded-[14px] bg-always-black text-oncolor-100 hover:bg-always-black/90 font-button transition-all"
              >
                {t.teachDone}
                {steps.length > 0 ? (
                  <span className="ml-1.5 opacity-70 font-small">
                    · {steps.length} {steps.length === 1 ? t.teachStep : t.teachSteps}
                  </span>
                ) : null}
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ─── review ───
  return (
    <div className="flex flex-col h-full bg-bg-100">
      <div className="flex items-center justify-between px-4 pt-3 pb-3">
        <h2 className="font-base-bold text-text-100">{t.teachSaveTitle}</h2>
        <button
          type="button"
          onClick={onClose}
          className="p-1.5 rounded-md transition-colors text-text-300 hover:bg-bg-300 hover:text-text-100"
          aria-label={t.cancel}
        >
          <CloseIcon size={12} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 space-y-3">
        <label className="block">
          <span className="font-small text-text-400">{t.teachNameLabel}</span>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="mt-1 w-full rounded-lg border-[0.5px] border-border-300 bg-bg-000 px-3 py-2 font-base text-sm text-text-100"
          />
        </label>

        <div className="space-y-2">
          {steps.map((s, i) => (
            <div
              key={s.id}
              className="border-[0.5px] border-border-300 rounded-xl px-3 py-2 bg-bg-000/30"
            >
              <p className="font-base text-sm text-text-100">
                {i + 1}. {s.description}
                {s.action === 'type' && s.masked ? (
                  <span className="text-text-400"> (••••••••)</span>
                ) : null}
              </p>
            </div>
          ))}
        </div>
        {error ? <p className="font-small text-danger-100">{error}</p> : null}
      </div>

      <div className="mx-auto mb-3 max-w-3xl w-full px-3 flex flex-col gap-2">
        <button
          type="button"
          disabled={saving}
          onClick={() => void save(true)}
          className="w-full px-4 py-2.5 rounded-[14px] bg-text-100 hover:bg-text-200 text-bg-100 font-button transition-all disabled:opacity-50 flex items-center justify-center gap-2"
        >
          {saving ? <SpinnerIcon size={14} className="animate-spin" /> : null}
          {saving ? t.teachGenerating : t.teachSaveAsShortcut}
        </button>
        <button
          type="button"
          disabled={saving}
          onClick={() => void save(false)}
          className="w-full px-4 py-2.5 rounded-[14px] border border-border-300 text-text-200 hover:bg-bg-200 font-button transition-colors disabled:opacity-50"
        >
          {t.teachSaveOnly}
        </button>
      </div>
    </div>
  );
}

/** Minimal Web Speech API surface — not always in lib.dom for our chrome types. */
interface BrowserSpeechRecognitionResult {
  readonly isFinal: boolean;
  readonly length: number;
  [index: number]: { transcript: string } | undefined;
}

interface BrowserSpeechRecognitionEvent {
  readonly resultIndex: number;
  readonly results: ArrayLike<BrowserSpeechRecognitionResult>;
}

interface BrowserSpeechRecognition {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((ev: BrowserSpeechRecognitionEvent) => void) | null;
  onerror: ((ev: Event) => void) | null;
  start(): void;
  stop(): void;
}

type BrowserSpeechRecognitionCtor = new () => BrowserSpeechRecognition;
