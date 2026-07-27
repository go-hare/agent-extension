/**
 * Teach Claude — in-page click + text-input capture (top frame).
 *
 * Official records click + selector + text + optional speech.
 * We capture clicks while `recording=true` (set via chrome.runtime message)
 * and post WORKFLOW_STEP to the extension (sidepanel listens).
 *
 * Text input is captured too: keystrokes into an <input>/<textarea>/
 * contenteditable are coalesced (debounced per element) into a single
 * `type` step, so typing "hello" yields one step, not five. Password and
 * other sensitive fields are masked — we record that a value was entered,
 * never the value itself.
 *
 * Does not block the click/typing (capture phase, no preventDefault) so
 * the user can still demonstrate the real UI.
 */

const MSG = {
  SET: 'WORKFLOW_RECORDER_SET',
  STEP: 'WORKFLOW_STEP',
} as const;

let recording = false;
let paused = false;

type ElementSnap = {
  tagName: string;
  text: string;
  selector: string;
  attributes: Record<string, string>;
};

function cssEscape(s: string): string {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') return CSS.escape(s);
  return s.replace(/([ !"#$%&'()*+,./:;<=>?@[\\\]^`{|}~])/g, '\\$1');
}

function buildSelector(el: Element): string {
  if (el.id) return `#${cssEscape(el.id)}`;
  const testId =
    el.getAttribute('data-testid') ||
    el.getAttribute('data-test-id') ||
    el.getAttribute('data-qa');
  if (testId) return `[data-testid="${testId.replace(/"/g, '\\"')}"]`;
  const aria = el.getAttribute('aria-label');
  if (aria) {
    return `${el.tagName.toLowerCase()}[aria-label="${aria.replace(/"/g, '\\"')}"]`;
  }
  const name = el.getAttribute('name');
  if (name) return `${el.tagName.toLowerCase()}[name="${name.replace(/"/g, '\\"')}"]`;

  const parts: string[] = [];
  let cur: Element | null = el;
  let depth = 0;
  while (cur && cur.nodeType === 1 && depth < 5 && cur !== document.body) {
    let part = cur.tagName.toLowerCase();
    if (cur.id) {
      parts.unshift(`#${cssEscape(cur.id)}`);
      break;
    }
    const parent: Element | null = cur.parentElement;
    if (parent) {
      const tag = cur.tagName;
      const siblings = Array.from(parent.children).filter(
        (c): c is Element => c instanceof Element && c.tagName === tag,
      );
      if (siblings.length > 1) {
        const idx = siblings.indexOf(cur) + 1;
        part += `:nth-of-type(${idx})`;
      }
    }
    parts.unshift(part);
    cur = parent;
    depth += 1;
  }
  return parts.join(' > ') || el.tagName.toLowerCase();
}

function snapElement(el: Element): ElementSnap {
  const text = (el.textContent || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
  const attrs: Record<string, string> = {};
  for (const name of ['id', 'name', 'type', 'role', 'aria-label', 'placeholder', 'title', 'href']) {
    const v = el.getAttribute(name);
    if (v) attrs[name] = v.slice(0, 200);
  }
  return {
    tagName: el.tagName.toLowerCase(),
    text,
    selector: buildSelector(el),
    attributes: attrs,
  };
}

function describeClick(snap: ElementSnap): string {
  const e = snap.attributes['aria-label'] || snap.attributes['title'] || snap.attributes['placeholder'];
  if (e) return `Click on "${e}"`;
  if (snap.text) {
    const t = snap.text.length > 40 ? `${snap.text.slice(0, 40)}…` : snap.text;
    return `Click on "${t}"`;
  }
  if (snap.attributes['name']) return `Click on ${snap.attributes['name']}`;
  if (snap.attributes['id']) return `Click on ${snap.attributes['id'].replace(/-/g, ' ')}`;
  return `Click on ${snap.tagName} element`;
}

function onClick(ev: MouseEvent): void {
  if (!recording || paused) return;
  if (ev.button !== 0) return;
  const target = ev.target;
  if (!(target instanceof Element)) return;
  // Ignore our own indicator host
  if (target.id === '__agent_activity_indicator__' || target.closest?.('#__agent_activity_indicator__')) {
    return;
  }

  // Moving the pointer commits any in-progress typing on another field,
  // so the type step lands before the click step (matches user intent order).
  if (pendingType && pendingType.el !== target && !pendingType.el.contains(target)) {
    flushType();
  }

  const snap = snapElement(target);
  const payload = {
    type: MSG.STEP,
    step: {
      action: 'click' as const,
      description: describeClick(snap),
      url: location.href,
      selector: snap.selector,
      elementText: snap.text,
      tagName: snap.tagName,
      timestamp: Date.now(),
      clickPosition: { x: ev.clientX, y: ev.clientY },
      viewportDimensions: { width: window.innerWidth, height: window.innerHeight },
    },
  };
  try {
    void chrome.runtime.sendMessage(payload);
  } catch {
    /* extension context invalidated */
  }
}

// ──────────────────────── text input capture ────────────────────────

/** Sensitive input types whose values we never record. */
const SENSITIVE_TYPES = new Set(['password']);
const SENSITIVE_NAME_RE = /pass(word)?|secret|token|cvv|cvc|card|ssn|creditcard/i;

function readFieldValue(el: Element): string {
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    return el.value;
  }
  if (el instanceof HTMLElement && el.isContentEditable) {
    return (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
  }
  return '';
}

function isSensitiveField(el: Element): boolean {
  if (el instanceof HTMLInputElement && SENSITIVE_TYPES.has(el.type.toLowerCase())) {
    return true;
  }
  const probe = [
    el.getAttribute('name'),
    el.getAttribute('id'),
    el.getAttribute('autocomplete'),
    el.getAttribute('aria-label'),
    el.getAttribute('placeholder'),
  ]
    .filter(Boolean)
    .join(' ');
  if (SENSITIVE_NAME_RE.test(probe)) return true;
  const ac = (el.getAttribute('autocomplete') || '').toLowerCase();
  return ac.includes('password') || ac.startsWith('cc-');
}

/** Editable element the event belongs to, or null. */
function editableTarget(ev: Event): Element | null {
  const t = ev.target;
  if (!(t instanceof Element)) return null;
  if (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement) return t;
  const ce = t.closest?.('[contenteditable=""],[contenteditable="true"]');
  return ce ?? null;
}

function describeType(el: Element, masked: boolean): string {
  const snap = snapElement(el);
  const label =
    snap.attributes['aria-label'] ||
    snap.attributes['placeholder'] ||
    snap.attributes['name'] ||
    snap.attributes['title'] ||
    // Only fall back to element text for non-sensitive fields — for a masked
    // contenteditable, snap.text could itself be the secret.
    (masked ? undefined : snap.text);
  if (masked) return label ? `Enter a value into "${label}"` : 'Enter a sensitive value';
  return label ? `Type into "${label}"` : `Type into ${snap.tagName}`;
}

interface PendingType {
  el: Element;
  timer: number;
}

/**
 * Debounce per editable element. When the user moves to a different field
 * (or clicks), we flush the previous field's accumulated text as one step.
 */
let pendingType: PendingType | null = null;

function flushType(): void {
  if (!pendingType) return;
  window.clearTimeout(pendingType.timer);
  const el = pendingType.el;
  pendingType = null;
  if (!recording || paused) return;
  if (!document.contains(el)) return;

  const masked = isSensitiveField(el);
  const raw = readFieldValue(el);
  const text = masked ? '' : raw.slice(0, 500);
  // Skip empty field edits (e.g. user focused then left without typing).
  if (!masked && text.trim().length === 0) return;

  const snap = snapElement(el);
  void safeSend({
    type: MSG.STEP,
    step: {
      action: 'type' as const,
      description: describeType(el, masked),
      url: location.href,
      selector: snap.selector,
      // For sensitive fields, never ship any page-derived content either:
      // a contenteditable's textContent would otherwise leak the typed value.
      elementText: masked ? undefined : snap.text,
      tagName: snap.tagName,
      text: text || undefined,
      masked: masked || undefined,
      timestamp: Date.now(),
    },
  });
}

function onInput(ev: Event): void {
  if (!recording || paused) return;
  const el = editableTarget(ev);
  if (!el) return;
  // Switching to a different field: flush the previous one first.
  if (pendingType && pendingType.el !== el) flushType();
  if (pendingType) window.clearTimeout(pendingType.timer);
  pendingType = {
    el,
    timer: window.setTimeout(flushType, 800),
  };
}

function safeSend(payload: unknown): void {
  try {
    void chrome.runtime.sendMessage(payload);
  } catch {
    /* extension context invalidated */
  }
}

function setRecording(next: boolean, nextPaused = false): void {
  recording = next;
  paused = nextPaused;
  if (!next) {
    // Discard any half-typed buffer when recording stops.
    if (pendingType) {
      window.clearTimeout(pendingType.timer);
      pendingType = null;
    }
  }
  document.documentElement.dataset.claudeWorkflowRecording = next ? (nextPaused ? 'paused' : '1') : '0';
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || typeof msg !== 'object') return false;
  if ((msg as { type?: string }).type === MSG.SET) {
    const m = msg as { recording?: boolean; paused?: boolean };
    setRecording(!!m.recording, !!m.paused);
    sendResponse({ ok: true, recording, paused });
    return false;
  }
  if ((msg as { type?: string }).type === 'WORKFLOW_RECORDER_PING') {
    sendResponse({ ok: true, recording, paused });
    return false;
  }
  return false;
});

document.addEventListener('click', onClick, true);
document.addEventListener('input', onInput, true);
// Flush the in-progress field when the user navigates away / commits a form.
document.addEventListener('change', () => flushType(), true);
window.addEventListener('pagehide', flushType);
