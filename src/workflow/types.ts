/**
 * Teach Claude / Record workflow — step model aligned with official
 * Claude in Chrome 1.0.81 capture pipeline.
 */

export type WorkflowAction =
  | 'click'
  | 'type'
  | 'navigate'
  | 'create_tab'
  | 'note'
  | 'narration';

export interface WorkflowStep {
  id: string;
  action: WorkflowAction;
  description: string;
  url?: string;
  selector?: string;
  elementText?: string;
  tagName?: string;
  /** Typed text (for type steps). */
  text?: string;
  /** Alias used by official type steps. */
  value?: string;
  /** True when the typed text was masked (password / sensitive field). */
  masked?: boolean;
  timestamp: number;
  speechTranscript?: string;
  clickPosition?: { x: number; y: number };
  viewportDimensions?: { width: number; height: number };
  /** JPEG base64 (no data: prefix). Stripped before persisting shortcuts. */
  screenshot?: string;
  tabId?: number;
  /** Pending type step still receiving keystrokes. */
  isPending?: boolean;
  /** LLM is rewriting description. */
  isEnhancing?: boolean;
  elementAttributes?: Record<string, string>;
}

export interface WorkflowRecordingMeta {
  startUrl?: string;
  pageTitle?: string;
  startedAt: number;
}

export function newStepId(): string {
  return `ws_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

/** Build a reusable shortcut prompt from recorded steps (local fallback). */
export function buildWorkflowPrompt(
  steps: WorkflowStep[],
  meta: WorkflowRecordingMeta,
  title?: string,
): string {
  const lines: string[] = [
    'The user taught you this browser workflow by demonstration. Reproduce it carefully on the current (or starting) page.',
    '',
    title ? `Workflow name: ${title}` : '',
    meta.pageTitle ? `Original page title: ${meta.pageTitle}` : '',
    meta.startUrl ? `Starting URL: ${meta.startUrl}` : '',
    '',
    'Steps (in order):',
  ].filter(Boolean);

  steps.forEach((s, i) => {
    const n = i + 1;
    let line = `${n}. [${s.action}] ${s.description}`;
    if (s.selector) line += ` (selector hint: ${s.selector})`;
    if (s.url && (s.action === 'navigate' || s.action === 'create_tab')) line += ` → ${s.url}`;
    const typed = s.text ?? s.value;
    if (typed) line += ` text=${JSON.stringify(typed)}`;
    if (s.masked) line += ' (sensitive value was masked — ask the user for it at run time)';
    if (s.speechTranscript) line += `\n   User said: "${s.speechTranscript}"`;
    lines.push(line);
  });

  lines.push(
    '',
    'How to execute:',
    '- Prefer read_page / find to locate elements by name; fall back to coordinates if needed.',
    '- Do not invent extra steps. If a step fails, report and stop or ask.',
    '- Never click file inputs; use upload tools if a step needs a file.',
    '- If the prompt lists dynamic inputs, ask the user for them first.',
  );

  return lines.join('\n');
}

export function slugCommand(title: string): string {
  const base = title
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32);
  return base || `workflow-${Date.now().toString(36).slice(-4)}`;
}

/** URLs where scripting / capture is blocked (official fK). */
export function isRecordableUrl(url: string | undefined | null): boolean {
  if (!url) return false;
  return !(
    url.startsWith('chrome://') ||
    url.startsWith('chrome-extension://') ||
    url.startsWith('about:') ||
    url.startsWith('edge://') ||
    url.startsWith('brave://') ||
    url.startsWith('devtools://') ||
    url.startsWith('chrome-search://') ||
    url.startsWith('https://chrome.google.com/webstore') ||
    url.startsWith('https://chromewebstore.google.com')
  );
}
