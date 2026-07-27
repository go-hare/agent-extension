/**
 * Official "Teach Claude" / Record workflow (nG + recording chrome).
 *
 * Flow:
 *  1. Intro — hero + "Start recording"
 *  2. Recording — capture clicks on the active tab; list steps; pause/stop
 *  3. Review — edit title, save as shortcut (and optionally run once)
 *
 * className shells mirror official:
 *   intro full panel; black primary CTA; step cards border-[0.5px]…
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { cn } from './cn';
import { CloseIcon, ListChecks, MousePointerClick, SpinnerIcon } from './icons';
import { useUi } from '@/i18n/UiLocaleContext';
import {
  buildWorkflowPrompt,
  newStepId,
  slugCommand,
  type WorkflowRecordingMeta,
  type WorkflowStep,
} from '@/workflow/types';
import { saveShortcut } from '@/shortcuts/store';
import { peekSettings } from '@/storage/settings';
import {
  clearRecording,
  groupKey,
  pushFrame,
  startRecording as gifStart,
  stopRecording as gifStop,
  getSession,
} from '@/gif/recorder';
import { encodeGif, uint8ToBase64 } from '@/gif/encode';
import * as shot from '@/cdp/screenshot';

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
  const speechRef = useRef<BrowserSpeechRecognition | null>(null);
  const [speechOn, setSpeechOn] = useState(false);
  const [interim, setInterim] = useState('');

  const hostLabel = (() => {
    try {
      return tabUrl ? new URL(tabUrl).hostname : '';
    } catch {
      return '';
    }
  })();

  const favicon = hostLabel
    ? `https://www.google.com/s2/favicons?domain=${hostLabel}&sz=32`
    : '';

  const pushStep = useCallback((partial: Omit<WorkflowStep, 'id'>) => {
    setSteps((prev) => [...prev, { ...partial, id: newStepId() }]);
  }, []);

  // ── GIF frame capture (optional; drives "Export GIF" in review) ──
  const gifKey = tabId !== undefined ? groupKey({ tabId }) : null;
  const framesOnRef = useRef(false);
  const [frameCount, setFrameCount] = useState(0);
  const [exporting, setExporting] = useState(false);
  const [exportMsg, setExportMsg] = useState<string | null>(null);

  const captureFrame = useCallback(
    async (label: string) => {
      if (!framesOnRef.current || !gifKey || tabId === undefined) return;
      try {
        const s = await shot.capture(tabId, { format: 'jpeg' });
        const r = pushFrame(gifKey, {
          jpegBase64: s.data,
          label: label.slice(0, 60),
          width: s.width,
          height: s.height,
        });
        if (r.ok) setFrameCount(r.count);
      } catch {
        /* frame capture is best-effort */
      }
    },
    [gifKey, tabId],
  );

  // Listen for content-script steps + navigation
  useEffect(() => {
    if (phase !== 'recording') return;

    const onMsg = (
      msg: { type?: string; step?: Omit<WorkflowStep, 'id'> },
      _sender: chrome.runtime.MessageSender,
    ) => {
      if (msg?.type === 'WORKFLOW_STEP' && msg.step && !paused) {
        const s = msg.step;
        pushStep({
          action: s.action || 'click',
          description: s.description || 'Step',
          url: s.url,
          selector: s.selector,
          elementText: s.elementText,
          tagName: s.tagName,
          text: s.text,
          masked: s.masked,
          timestamp: s.timestamp || Date.now(),
          clickPosition: s.clickPosition,
          viewportDimensions: s.viewportDimensions,
          speechTranscript: interim || undefined,
        });
        setInterim('');
        void captureFrame(s.description);
      }
    };
    chrome.runtime.onMessage.addListener(onMsg);

    const onNav = (
      details: chrome.webNavigation.WebNavigationTransitionCallbackDetails,
    ) => {
      if (paused) return;
      if (tabId !== undefined && details.tabId !== tabId) return;
      if (details.frameId !== 0) return;
      if (details.transitionType === 'auto_subframe') return;
      pushStep({
        action: 'navigate',
        description: `Navigate to ${details.url}`,
        url: details.url,
        timestamp: Date.now(),
      });
      void captureFrame(`Navigate to ${details.url}`);
    };
    chrome.webNavigation.onCommitted.addListener(onNav);

    return () => {
      chrome.runtime.onMessage.removeListener(onMsg);
      chrome.webNavigation.onCommitted.removeListener(onNav);
    };
  }, [phase, paused, tabId, pushStep, interim]);

  const setTabRecording = useCallback(
    async (recording: boolean, isPaused = false) => {
      if (tabId === undefined) return;
      try {
        await chrome.tabs.sendMessage(tabId, {
          type: 'WORKFLOW_RECORDER_SET',
          recording,
          paused: isPaused,
        });
      } catch {
        // Content script not present (chrome://, Web Store, or not yet loaded).
        if (recording) setError(t.teachNeedPage);
      }
    },
    [tabId, t.teachNeedPage],
  );

  const startRecording = useCallback(async () => {
    setError(null);
    setSteps([]);
    setPaused(false);
    setExportMsg(null);
    metaRef.current = {
      startedAt: Date.now(),
      startUrl: tabUrl,
      pageTitle: tabTitle,
    };
    // Optional GIF frame capture for the whole recording session.
    const wantFrames = peekSettings().teachCaptureFrames && gifKey;
    framesOnRef.current = Boolean(wantFrames);
    setFrameCount(0);
    if (wantFrames && gifKey) {
      clearRecording(gifKey);
      gifStart(gifKey);
      void captureFrame('start');
    }
    onPhase('recording');
    await setTabRecording(true, false);
  }, [onPhase, setTabRecording, tabTitle, tabUrl, gifKey, captureFrame]);

  const stopRecording = useCallback(async () => {
    await setTabRecording(false, false);
    stopSpeech();
    if (gifKey && framesOnRef.current) {
      await captureFrame('end');
      gifStop(gifKey);
    }
    framesOnRef.current = false;
    setTitle(tabTitle ? `Workflow: ${tabTitle.slice(0, 40)}` : t.teachDefaultTitle);
    onPhase('review');
  }, [onPhase, setTabRecording, t.teachDefaultTitle, tabTitle, gifKey, captureFrame]);

  const togglePause = useCallback(async () => {
    const next = !paused;
    setPaused(next);
    await setTabRecording(true, next);
  }, [paused, setTabRecording]);

  const removeStep = (id: string) => {
    setSteps((prev) => prev.filter((s) => s.id !== id));
  };

  function stopSpeech() {
    try {
      speechRef.current?.stop();
    } catch {
      /* ignore */
    }
    speechRef.current = null;
    setSpeechOn(false);
    setInterim('');
  }

  const toggleSpeech = () => {
    if (speechOn) {
      stopSpeech();
      return;
    }
    const w = window as Window & {
      SpeechRecognition?: BrowserSpeechRecognitionCtor;
      webkitSpeechRecognition?: BrowserSpeechRecognitionCtor;
    };
    const SR = w.SpeechRecognition || w.webkitSpeechRecognition;
    if (!SR) {
      setError(t.teachSpeechUnsupported);
      return;
    }
    const rec = new SR();
    rec.continuous = true;
    rec.interimResults = true;
    // Language from Options; fall back to the UI locale, then browser default.
    const st = peekSettings();
    rec.lang = st.teachSpeechLang || st.locale || '';
    rec.onresult = (ev: BrowserSpeechRecognitionEvent) => {
      let interimText = '';
      let finalText = '';
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const r = ev.results[i];
        if (!r) continue;
        const piece = r[0]?.transcript ?? '';
        if (r.isFinal) finalText += piece;
        else interimText += piece;
      }
      if (finalText) {
        setSteps((prev) => {
          if (prev.length === 0) {
            return [
              {
                id: newStepId(),
                action: 'note',
                description: 'Voice note',
                timestamp: Date.now(),
                speechTranscript: finalText.trim(),
              },
            ];
          }
          const copy = [...prev];
          const last = copy[copy.length - 1]!;
          copy[copy.length - 1] = {
            ...last,
            speechTranscript: [last.speechTranscript, finalText.trim()]
              .filter(Boolean)
              .join(' '),
          };
          return copy;
        });
      }
      setInterim(interimText);
    };
    rec.onerror = () => {
      setSpeechOn(false);
    };
    try {
      rec.start();
      speechRef.current = rec;
      setSpeechOn(true);
      setError(null);
    } catch {
      setError(t.teachSpeechUnsupported);
    }
  };

  useEffect(() => {
    return () => {
      void setTabRecording(false, false);
      stopSpeech();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-start speech when entering the recording phase, if enabled in Options.
  const speechAutoRef = useRef(false);
  useEffect(() => {
    if (phase === 'recording' && !speechAutoRef.current) {
      speechAutoRef.current = true;
      if (peekSettings().teachSpeechEnabled && !speechOn) {
        toggleSpeech();
      }
    }
    if (phase !== 'recording') speechAutoRef.current = false;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  /** Export the captured GIF frames as a download (review phase). */
  const exportGif = useCallback(async () => {
    if (!gifKey) return;
    const sess = getSession(gifKey);
    if (!sess || sess.frames.length === 0) {
      setExportMsg(t.teachNoFrames);
      return;
    }
    setExporting(true);
    setExportMsg(null);
    try {
      const encoded = await encodeGif(
        sess.frames.map((f) => ({ jpegBase64: f.jpegBase64, label: f.label })),
        { delayCs: 50, maxSide: 640 },
      );
      const b64 = uint8ToBase64(encoded.data);
      const name = (title.trim() || t.teachDefaultTitle)
        .toLowerCase()
        .replace(/[^a-z0-9一-鿿]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 40);
      await chrome.downloads.download({
        url: `data:image/gif;base64,${b64}`,
        filename: `${name || 'workflow'}.gif`,
        saveAs: true,
      });
      setExportMsg(t.teachGifSaved(sess.frames.length));
    } catch (e) {
      setExportMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setExporting(false);
    }
  }, [gifKey, title, t]);

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
      const prompt = buildWorkflowPrompt(steps, metaRef.current, name);
      const sc = await saveShortcut({
        command,
        title: name,
        description: t.teachShortcutDesc(steps.length),
        prompt,
      });
      // Always notify parent (refresh shortcuts list); pass prompt only when running.
      onSaved?.(andRun ? prompt : '', { command: sc.command, title: sc.title });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  if (phase === 'intro') {
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
              {tabTitle || hostLabel || t.teachClaude}
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
              <p className="text-text-300 font-base max-w-[280px] mx-auto">{t.teachIntroBody}</p>
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
              <button
                type="button"
                onClick={() => void startRecording()}
                className="w-full justify-center flex items-center px-4 py-2.5 rounded-[14px] bg-always-black text-oncolor-100 hover:bg-always-black/90 font-button transition-all"
              >
                <span className="inline-block w-2 h-2 rounded-full bg-danger-100 mr-2" />
                {t.teachStartRecording}
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (phase === 'recording') {
    return (
      <div className="flex flex-col h-full bg-bg-100">
        <div className="flex items-center justify-between px-4 pt-3 pb-3">
          <div className="flex items-center gap-2">
            <span
              className={cn(
                'inline-flex items-center gap-1.5 font-base text-sm',
                paused ? 'text-text-400' : 'text-danger-100',
              )}
            >
              <span
                className={cn(
                  'w-2 h-2 rounded-full',
                  paused ? 'bg-text-400' : 'bg-danger-100 animate-pulse',
                )}
              />
              {paused ? t.teachPaused : t.teachRecording}
            </span>
            <span className="font-small text-text-500">
              {steps.length} {steps.length === 1 ? t.teachStep : t.teachSteps}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void togglePause()}
              className="px-2 py-1 rounded-md border-[0.5px] border-border-300 font-small text-text-200 hover:bg-bg-200"
            >
              {paused ? t.teachResume : t.teachPause}
            </button>
            <button
              type="button"
              onClick={toggleSpeech}
              className={cn(
                'px-2 py-1 rounded-md border-[0.5px] border-border-300 font-small hover:bg-bg-200',
                speechOn ? 'text-brand-100 border-brand-100' : 'text-text-200',
              )}
              title={t.teachVoice}
            >
              {speechOn ? t.teachVoiceOn : t.teachVoice}
            </button>
            <button
              type="button"
              onClick={() => void stopRecording()}
              className="px-2 py-1 rounded-md bg-text-100 text-bg-100 font-small hover:bg-text-200"
            >
              {t.teachStop}
            </button>
          </div>
        </div>

        {interim ? (
          <p className="px-4 font-small text-text-400 italic truncate">“{interim}”</p>
        ) : null}
        {error ? <p className="px-4 font-small text-danger-100">{error}</p> : null}

        <div className="flex-1 overflow-y-auto px-3 pb-4 space-y-2">
          {steps.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center px-6">
              <ListChecks size={20} className="text-text-400 mb-2" />
              <p className="font-base text-text-300">{t.teachClickHint}</p>
            </div>
          ) : (
            steps.map((s, i) => (
              <div
                key={s.id}
                className="group border-[0.5px] border-border-300 rounded-xl bg-bg-000/30 px-3 py-2"
              >
                <div className="flex items-start gap-2">
                  <span className="font-small text-text-500 shrink-0 w-5">{i + 1}.</span>
                  <div className="min-w-0 flex-1">
                    <p className="font-base text-sm text-text-100">{s.description}</p>
                    {s.action === 'type' && (s.text || s.masked) ? (
                      <p className="font-claude-response-code text-text-300 truncate mt-0.5">
                        {s.masked ? '••••••••' : s.text}
                      </p>
                    ) : null}
                    {s.selector ? (
                      <p className="font-claude-response-code text-text-400 truncate">{s.selector}</p>
                    ) : null}
                    {s.speechTranscript ? (
                      <p className="font-small text-text-300 italic mt-1">“{s.speechTranscript}”</p>
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
              </div>
            ))
          )}
        </div>
      </div>
    );
  }

  // review
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
        {frameCount > 0 ? (
          <button
            type="button"
            disabled={exporting}
            onClick={() => void exportGif()}
            className="w-full px-4 py-2.5 rounded-[14px] border border-border-300 text-text-200 hover:bg-bg-200 font-button transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {exporting ? <SpinnerIcon size={14} className="animate-spin" /> : null}
            {exporting ? t.teachExporting : t.teachExportGif(frameCount)}
          </button>
        ) : null}
        {exportMsg ? <p className="font-small text-text-400 text-center">{exportMsg}</p> : null}
        <button
          type="button"
          disabled={saving}
          onClick={() => void save(true)}
          className="w-full px-4 py-2.5 rounded-[14px] bg-text-100 hover:bg-text-200 text-bg-100 font-button transition-all disabled:opacity-50 flex items-center justify-center gap-2"
        >
          {saving ? <SpinnerIcon size={14} className="animate-spin" /> : null}
          {t.teachSaveAndRun}
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
