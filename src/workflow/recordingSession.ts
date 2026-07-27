/**
 * Official-style Teach Claude recording session (gK port).
 * Sidepanel-owned: inject selector loop, keystrokes, multi-tab group, screenshots.
 */

import { annotateClick, captureTabJpeg } from './annotateScreenshot';
import { describeClick, describeType } from './describeStep';
import { enhanceStepDescription } from './enhance';
import {
  cancelElementSelector,
  injectElementSelector,
  type ElementSelection,
} from './elementSelector';
import {
  isRecordableUrl,
  newStepId,
  type WorkflowRecordingMeta,
  type WorkflowStep,
} from './types';

export type RecordingListener = (steps: WorkflowStep[]) => void;

export type RecordingSessionOptions = {
  onSteps: RecordingListener;
  onPausedChange?: (paused: boolean) => void;
  onError?: (message: string) => void;
  /** Enable per-step LLM description enhance (default true if credentials). */
  enhance?: boolean;
  getSpeechSince?: (sinceTs: number) => string | undefined;
};

export class RecordingSession {
  private steps: WorkflowStep[] = [];
  private recording = false;
  private paused = false;
  private trackedTabs = new Set<number>();
  private seenCreate = new Set<number>();
  private seenNav = new Set<number>();
  private injectInFlight = new Set<number>();
  private handledTimestamps = new Set<number>();
  private tabGroupId: number | undefined;
  private activeTabId: number | undefined;
  private speechCutoff = 0;
  private meta: WorkflowRecordingMeta = { startedAt: Date.now() };
  private opts: RecordingSessionOptions;
  private cleaned = false;

  private onActivated?: (activeInfo: { tabId: number; windowId: number }) => void;
  private onKeystroke?: (
    msg: {
      type?: string;
      text?: string;
      isFinal?: boolean;
      element?: { tagName?: string; selector?: string; name?: string };
    },
    sender: chrome.runtime.MessageSender,
  ) => void;
  private onNavCommitted?: (
    details: chrome.webNavigation.WebNavigationTransitionCallbackDetails,
  ) => void;

  constructor(opts: RecordingSessionOptions) {
    this.opts = opts;
  }

  get isRecording(): boolean {
    return this.recording;
  }
  get isPaused(): boolean {
    return this.paused;
  }
  get currentSteps(): WorkflowStep[] {
    return this.steps;
  }
  get recordingMeta(): WorkflowRecordingMeta {
    return this.meta;
  }
  get boundTabId(): number | undefined {
    return this.activeTabId;
  }

  private emit() {
    this.opts.onSteps([...this.steps]);
  }

  private setPaused(next: boolean) {
    this.paused = next;
    this.opts.onPausedChange?.(next);
  }

  private push(step: Omit<WorkflowStep, 'id'> & { id?: string }) {
    const full: WorkflowStep = { ...step, id: step.id ?? newStepId() };
    this.steps = [...this.steps, full];
    this.emit();
    return full;
  }

  private updateStep(id: string, patch: Partial<WorkflowStep>) {
    this.steps = this.steps.map((s) => (s.id === id ? { ...s, ...patch } : s));
    this.emit();
  }

  private replaceSteps(next: WorkflowStep[]) {
    this.steps = next;
    this.emit();
  }

  async start(tabId: number): Promise<{ ok: boolean; error?: string }> {
    if (this.recording) await this.stop();
    this.cleaned = false;
    this.steps = [];
    this.recording = true;
    this.setPaused(false);
    this.trackedTabs = new Set([tabId]);
    this.seenCreate = new Set([tabId]);
    this.seenNav = new Set([tabId]);
    this.injectInFlight.clear();
    this.handledTimestamps.clear();
    this.activeTabId = tabId;
    this.speechCutoff = Date.now();

    let tab: chrome.tabs.Tab | undefined;
    try {
      tab = await chrome.tabs.get(tabId);
    } catch {
      return { ok: false, error: 'Could not access the browser tab.' };
    }
    this.tabGroupId = tab.groupId;
    const url = tab.url || '';
    if (!isRecordableUrl(url)) {
      this.recording = false;
      return {
        ok: false,
        error: 'Open a normal web page (not chrome:// or the store) so clicks can be recorded.',
      };
    }

    this.meta = {
      startedAt: Date.now(),
      startUrl: url,
      pageTitle: tab.title || '',
    };

    this.push({
      action: 'navigate',
      description: `Navigate to ${url || 'page'}`,
      url,
      tabId,
      timestamp: Date.now() - 100,
    });

    this.attachListeners();
    void this.ensureInject(tabId);
    return { ok: true };
  }

  async stop(): Promise<WorkflowStep[]> {
    if (!this.recording && this.cleaned) return this.steps;
    this.recording = false;
    this.finalizePendingTypes();
    this.detachListeners();
    await this.cancelAllInjects();
    this.cleaned = true;
    return this.steps;
  }

  async togglePause(): Promise<void> {
    if (!this.recording) return;
    if (this.paused) {
      this.setPaused(false);
      if (this.activeTabId !== undefined) void this.ensureInject(this.activeTabId);
    } else {
      this.setPaused(true);
      await this.cancelAllInjects();
    }
  }

  private attachListeners() {
    this.onKeystroke = (msg, sender) => {
      if (!this.recording || this.paused) return;
      if (msg?.type !== 'KEYSTROKE_UPDATE') return;
      const tabId = sender.tab?.id;
      if (tabId !== undefined && !this.trackedTabs.has(tabId)) return;
      this.handleKeystroke(msg, tabId);
    };
    chrome.runtime.onMessage.addListener(this.onKeystroke);

    this.onActivated = (info) => {
      if (!this.recording || this.paused) return;
      void this.handleTabActivated(info.tabId);
    };
    chrome.tabs.onActivated.addListener(this.onActivated);

    this.onNavCommitted = (details) => {
      if (!this.recording || this.paused) return;
      if (details.frameId !== 0) return;
      if (!this.trackedTabs.has(details.tabId)) return;
      if (details.transitionType === 'auto_subframe') return;
      // Full navigation — re-inject after load
      if (isRecordableUrl(details.url)) {
        this.push({
          action: 'navigate',
          description: `Navigate to ${details.url}`,
          url: details.url,
          tabId: details.tabId,
          timestamp: Date.now(),
        });
        setTimeout(() => {
          if (this.recording && !this.paused) void this.ensureInject(details.tabId);
        }, 400);
      }
    };
    chrome.webNavigation.onCommitted.addListener(this.onNavCommitted);
  }

  private detachListeners() {
    if (this.onKeystroke) {
      chrome.runtime.onMessage.removeListener(this.onKeystroke);
      this.onKeystroke = undefined;
    }
    if (this.onActivated) {
      chrome.tabs.onActivated.removeListener(this.onActivated);
      this.onActivated = undefined;
    }
    if (this.onNavCommitted) {
      chrome.webNavigation.onCommitted.removeListener(this.onNavCommitted);
      this.onNavCommitted = undefined;
    }
  }

  private async cancelAllInjects() {
    const ids = [...this.trackedTabs];
    this.injectInFlight.clear();
    await Promise.all(ids.map((id) => cancelElementSelector(id)));
  }

  private async handleTabActivated(tabId: number) {
    let tab: chrome.tabs.Tab;
    try {
      tab = await chrome.tabs.get(tabId);
    } catch {
      return;
    }
    const groupId = tab.groupId;
    const recordedGroup = this.tabGroupId;
    // Official: different group → auto-pause
    if (
      recordedGroup !== undefined &&
      recordedGroup !== -1 &&
      groupId !== recordedGroup
    ) {
      this.setPaused(true);
      await this.cancelAllInjects();
      return;
    }

    const isNewTab = !this.seenCreate.has(tabId);
    const isNewNav = !this.seenNav.has(tabId);
    if (isNewTab) {
      this.seenCreate.add(tabId);
      this.push({
        action: 'create_tab',
        description: 'Create new tab',
        url: tab.url || '',
        tabId,
        timestamp: Date.now() - 150,
      });
    }
    if (isNewNav && isRecordableUrl(tab.url)) {
      this.seenNav.add(tabId);
      this.push({
        action: 'navigate',
        description: `Navigate to ${tab.url || 'page'}`,
        url: tab.url || '',
        tabId,
        timestamp: Date.now() - 100,
      });
    }

    this.trackedTabs.add(tabId);
    this.activeTabId = tabId;
    if (isRecordableUrl(tab.url)) {
      void this.ensureInject(tabId);
    }
  }

  private handleKeystroke(
    msg: {
      text?: string;
      isFinal?: boolean;
      element?: {
        tagName?: string;
        selector?: string;
        name?: string;
        inputType?: string;
      };
    },
    tabId?: number,
  ) {
    const raw = msg.text ?? '';
    const el = msg.element;
    const masked =
      (el?.inputType || '').toLowerCase() === 'password' ||
      /password/i.test(el?.name || '') ||
      /password/i.test(el?.selector || '');

    if (!raw) {
      this.replaceSteps(this.steps.filter((s) => !(s.action === 'type' && s.isPending)));
      return;
    }

    // Never persist password field contents in steps / prompts.
    const text = masked ? '••••••••' : raw;
    const description = masked
      ? describeType('[password]', { name: el?.name || 'password', selector: el?.selector })
      : describeType(raw, { name: el?.name, selector: el?.selector });
    const pendingIdx = this.steps.findIndex((s) => s.action === 'type' && s.isPending);

    if (pendingIdx >= 0) {
      const copy = [...this.steps];
      const prev = copy[pendingIdx]!;
      copy[pendingIdx] = {
        ...prev,
        text,
        value: text,
        description,
        selector: el?.selector ?? prev.selector,
        isPending: !msg.isFinal,
        masked: masked || prev.masked,
      };
      this.replaceSteps(copy);
      return;
    }

    if (!msg.isFinal) {
      this.push({
        action: 'type',
        selector: el?.selector,
        text,
        value: text,
        description,
        tabId,
        timestamp: Date.now(),
        isPending: true,
        tagName: el?.tagName,
        masked: masked || undefined,
      });
    }
  }

  private finalizePendingTypes() {
    this.replaceSteps(
      this.steps.map((s) =>
        s.action === 'type' && s.isPending ? { ...s, isPending: false } : s,
      ),
    );
  }

  private async ensureInject(tabId: number) {
    if (!this.recording || this.paused) return;
    if (this.injectInFlight.has(tabId)) return;
    this.injectInFlight.add(tabId);
    try {
      const selection = await injectElementSelector(tabId);
      this.injectInFlight.delete(tabId);
      if (!this.recording || this.paused) return;
      if (selection) {
        await this.handleSelection(selection);
        // Official re-arm delay
        setTimeout(() => {
          if (this.recording && !this.paused) void this.ensureInject(tabId);
        }, 350);
      } else if (this.recording && !this.paused) {
        // Timeout / cancel — try again if still live
        setTimeout(() => {
          if (this.recording && !this.paused) void this.ensureInject(tabId);
        }, 500);
      }
    } catch (e) {
      this.injectInFlight.delete(tabId);
      this.opts.onError?.(e instanceof Error ? e.message : String(e));
    }
  }

  private async handleSelection(sel: ElementSelection) {
    if (this.handledTimestamps.has(sel.timestamp)) return;
    this.handledTimestamps.add(sel.timestamp);
    setTimeout(() => this.handledTimestamps.delete(sel.timestamp), 60_000);

    if (!this.recording || this.paused) return;

    // Screenshot — force-activate target tab so side-panel focus doesn't blank capture
    let shot: string | null = null;
    try {
      shot = await captureTabJpeg({
        tabId: sel.tabId,
        forceTabActivation: true,
      });
    } catch {
      shot = await captureTabJpeg({ forceTabActivation: true });
    }

    // Finalize pending type with screenshot
    const pendingIdx = this.steps.findIndex((s) => s.action === 'type' && s.isPending);
    if (pendingIdx >= 0) {
      const copy = [...this.steps];
      copy[pendingIdx] = {
        ...copy[pendingIdx]!,
        screenshot: shot || undefined,
        isPending: false,
        timestamp: sel.timestamp - 1,
      };
      this.replaceSteps(copy);
    } else if (sel.typedText && sel.typedInElement) {
      const typedMasked =
        (sel.typedInElement.inputType || '').toLowerCase() === 'password' ||
        /password/i.test(sel.typedInElement.name || '') ||
        /password/i.test(sel.typedInElement.selector || '');
      const typedText = typedMasked ? '••••••••' : sel.typedText;
      this.push({
        action: 'type',
        selector: sel.typedInElement.selector,
        text: typedText,
        value: typedText,
        description: typedMasked
          ? describeType('[password]', {
              name: sel.typedInElement.name || 'password',
              selector: sel.typedInElement.selector,
            })
          : describeType(sel.typedText, {
              name: sel.typedInElement.name,
              selector: sel.typedInElement.selector,
            }),
        screenshot: shot || undefined,
        url: sel.url,
        tabId: sel.tabId,
        timestamp: sel.timestamp - 1,
        tagName: sel.typedInElement.tagName,
        masked: typedMasked || undefined,
      });
    }

    const clickPos =
      sel.clickCoordinates ||
      (sel.element.boundingRect
        ? {
            x: sel.element.boundingRect.x + sel.element.boundingRect.width / 2,
            y: sel.element.boundingRect.y + sel.element.boundingRect.height / 2,
          }
        : undefined);

    let annotated = shot;
    if (
      shot &&
      clickPos &&
      sel.viewportWidth &&
      sel.viewportHeight
    ) {
      try {
        annotated = await annotateClick(
          shot,
          clickPos,
          { width: sel.viewportWidth, height: sel.viewportHeight },
        );
      } catch {
        annotated = shot;
      }
    }

    const speech = this.opts.getSpeechSince?.(this.speechCutoff);
    this.speechCutoff = sel.timestamp;

    const description = describeClick({
      tagName: sel.element.tagName,
      text: sel.element.text,
      attributes: sel.element.attributes,
      selector: sel.element.selector,
    });

    const doEnhance = this.opts.enhance !== false;
    const step = this.push({
      action: 'click',
      selector: sel.element.selector,
      screenshot: annotated || undefined,
      description,
      url: sel.url,
      tabId: sel.tabId,
      elementText: sel.element.text,
      tagName: sel.element.tagName,
      elementAttributes: sel.element.attributes,
      timestamp: sel.timestamp,
      viewportDimensions:
        sel.viewportWidth && sel.viewportHeight
          ? { width: sel.viewportWidth, height: sel.viewportHeight }
          : undefined,
      clickPosition: clickPos,
      isEnhancing: doEnhance,
      speechTranscript: speech,
    });

    if (doEnhance) {
      void this.enhanceStep(step, annotated || undefined);
    }
  }

  private async enhanceStep(step: WorkflowStep, screenshot?: string) {
    try {
      let pageTitle = '';
      if (step.tabId !== undefined) {
        try {
          pageTitle = (await chrome.tabs.get(step.tabId)).title || '';
        } catch {
          /* ignore */
        }
      }
      const next = await enhanceStepDescription({
        tagName: step.tagName || 'div',
        text: step.elementText,
        attributes: step.elementAttributes || {},
        url: step.url,
        pageTitle,
        action: 'click',
        selector: step.selector,
        screenshot,
        speechTranscript: step.speechTranscript,
      });
      if (next) {
        this.updateStep(step.id, { description: next, isEnhancing: false });
      } else {
        this.updateStep(step.id, { isEnhancing: false });
      }
    } catch {
      this.updateStep(step.id, { isEnhancing: false });
    }
  }
}
