/**
 * Official injectElementSelector port (Claude in Chrome 1.0.81).
 *
 * Ephemeral page inject via chrome.scripting.executeScript — not a permanent
 * content script. One click → ELEMENT_SELECTION → host re-injects for next.
 */

export type ElementInfo = {
  selector: string;
  tagName: string;
  text: string;
  attributes: Record<string, string>;
  boundingRect: {
    x: number;
    y: number;
    width: number;
    height: number;
    top: number;
    right: number;
    bottom: number;
    left: number;
  };
};

export type TypedInElement = {
  tagName: string;
  selector: string;
  name: string;
  /** input type when known (e.g. password → host masks step text). */
  inputType?: string;
};

export type ElementSelection = {
  element: ElementInfo;
  url: string;
  timestamp: number;
  tabId: number;
  viewportWidth?: number;
  viewportHeight?: number;
  clickCoordinates?: { x: number; y: number };
  typedText?: string;
  typedInElement?: TypedInElement;
};

const TIMEOUT_MS = 60_000;

/**
 * Injected into the page (serialized by executeScript — no closures from host).
 * Mirrors official hK.injectElementSelector page body.
 */
function pageElementSelectorInstall(): void {
  const w = window as Window & {
    __clickListenerActive?: boolean;
    __keystrokeListenersActive?: boolean;
    __teachClaudeTeardown?: (full?: boolean) => void;
  };
  if (w.__clickListenerActive) return;
  w.__clickListenerActive = true;

  let handling = false;
  let keyBuf: string[] = [];
  let focusedEl: Element | null = null;

  const classNameOf = (el: Element): string => {
    const cn = (el as HTMLElement).className;
    if (!cn) return '';
    if (typeof cn === 'object' && cn && 'baseVal' in cn) {
      return String((cn as { baseVal: string }).baseVal || '');
    }
    return String(cn);
  };

  const inputTypeOf = (el: Element): string => {
    if (el instanceof HTMLInputElement) return (el.type || 'text').toLowerCase();
    return (el.getAttribute('type') || '').toLowerCase();
  };

  const elementMeta = (el: HTMLElement) => {
    const cn = classNameOf(el);
    return {
      tagName: el.tagName.toLowerCase(),
      selector: el.id
        ? `#${el.id}`
        : cn
          ? `${el.tagName.toLowerCase()}.${cn.trim().split(/\s+/).join('.')}`
          : el.tagName.toLowerCase(),
      name:
        el.getAttribute('name') ||
        el.getAttribute('placeholder') ||
        el.getAttribute('aria-label') ||
        '',
      inputType: inputTypeOf(el) || undefined,
    };
  };

  const onCancelMsg = (msg: { type?: string }) => {
    if (msg?.type !== 'CANCEL_ELEMENT_SELECTOR') return;
    teardown(true);
  };
  chrome.runtime.onMessage.addListener(onCancelMsg);

  const flushKeystrokes = (isFinal: boolean) => {
    if (!focusedEl || keyBuf.length === 0) return;
    const el = focusedEl as HTMLElement;
    chrome.runtime.sendMessage({
      type: 'KEYSTROKE_UPDATE',
      text: keyBuf.join(''),
      element: elementMeta(el),
      isFinal: isFinal || undefined,
    });
  };

  const onFocus = (ev: FocusEvent) => {
    const t = ev.target;
    if (!(t instanceof Element)) return;
    if (focusedEl && t !== focusedEl && keyBuf.length > 0) {
      flushKeystrokes(true);
      keyBuf = [];
    }
    focusedEl = t;
  };

  const keystrokeWasOff = !w.__keystrokeListenersActive;
  if (keystrokeWasOff) {
    document.addEventListener('focus', onFocus, true);
  }

  /** Sync buffer from control value — covers IME composition, paste, autofill. */
  const isTypeable = (el: Element | null): el is HTMLElement => {
    if (!el) return false;
    const tag = el.tagName.toLowerCase();
    if (tag === 'textarea') return true;
    if (tag === 'input') {
      const type = ((el as HTMLInputElement).type || 'text').toLowerCase();
      return !['submit', 'button', 'checkbox', 'radio', 'file', 'image', 'reset', 'hidden'].includes(
        type,
      );
    }
    return (el as HTMLElement).isContentEditable || el.getAttribute('contenteditable') === 'true';
  };

  const readControlText = (el: HTMLElement): string => {
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
      return el.value ?? '';
    }
    if (el.isContentEditable || el.getAttribute('contenteditable') === 'true') {
      return el.innerText ?? el.textContent ?? '';
    }
    return '';
  };

  const syncKeyBufFromControl = (el: Element | null, sendUpdate: boolean) => {
    if (!isTypeable(el)) return;
    focusedEl = el;
    const text = readControlText(el);
    // Character-split so backspace path still works on latin; CJK stored as full string join.
    keyBuf = text ? Array.from(text) : [];
    if (sendUpdate) {
      chrome.runtime.sendMessage({
        type: 'KEYSTROKE_UPDATE',
        text: keyBuf.join(''),
        element: elementMeta(el),
      });
    }
  };

  const onKeydown = (ev: KeyboardEvent) => {
    if (
      ev.target instanceof Element &&
      ['INPUT', 'TEXTAREA'].includes(ev.target.tagName.toUpperCase())
    ) {
      focusedEl = ev.target;
    }
    if (!focusedEl) return;
    const el = focusedEl as HTMLInputElement;
    if (!isTypeable(el)) return;
    const key = ev.key;
    const send = () => {
      chrome.runtime.sendMessage({
        type: 'KEYSTROKE_UPDATE',
        text: keyBuf.join(''),
        element: elementMeta(el),
      });
    };

    // During IME composition, keydown chars are intermediate — wait for compositionend/input.
    if (ev.isComposing || key === 'Process' || key === 'Unidentified') {
      return;
    }

    if (key === 'Backspace') {
      keyBuf.pop();
      send();
      return;
    }
    if (key === 'Enter') {
      keyBuf.push('\n');
      send();
      return;
    }
    if (key === 'Tab') {
      keyBuf.push('\t');
      send();
      return;
    }
    if (
      ['Control', 'Shift', 'Alt', 'Meta'].includes(key) ||
      ev.ctrlKey ||
      ev.altKey ||
      ev.metaKey ||
      key.startsWith('Arrow') ||
      (key.startsWith('F') && key.length <= 3) ||
      ['Home', 'End', 'PageUp', 'PageDown', 'Delete', 'Insert', 'Escape'].includes(key) ||
      key.length !== 1
    ) {
      return;
    }
    keyBuf.push(key);
    send();
  };

  // input / compositionend / paste: official-parity type fidelity for IME & clipboard.
  const onInputOrPaste = (ev: Event) => {
    const t = ev.target;
    if (!(t instanceof Element)) return;
    syncKeyBufFromControl(t, true);
  };

  const onCompositionEnd = (ev: CompositionEvent) => {
    const t = ev.target;
    if (!(t instanceof Element)) return;
    syncKeyBufFromControl(t, true);
  };

  if (keystrokeWasOff) {
    document.addEventListener('keydown', onKeydown, true);
    document.addEventListener('input', onInputOrPaste, true);
    document.addEventListener('paste', onInputOrPaste, true);
    document.addEventListener('compositionend', onCompositionEnd, true);
    w.__keystrokeListenersActive = true;
  }

  const onEscape = (ev: KeyboardEvent) => {
    if (ev.key !== 'Escape') return;
    ev.preventDefault();
    try {
      chrome.runtime.sendMessage({ type: 'ELEMENT_SELECTION', cancelled: true });
    } catch {
      /* ignore */
    }
    teardown(true);
  };

  const onClick = async (ev: MouseEvent) => {
    ev.preventDefault();
    ev.stopPropagation();
    if (handling) return;
    handling = true;
    try {
      const target = document.elementFromPoint(ev.clientX, ev.clientY);
      if (!target) {
        handling = false;
        return;
      }
      const rect = target.getBoundingClientRect();
      const tag = target.tagName.toLowerCase();
      const candidates: string[] = [];
      if (target.id) candidates.push(`#${target.id}`);
      const cn = classNameOf(target);
      if (cn) {
        const parts = cn
          .trim()
          .split(/\s+/)
          .filter(Boolean);
        if (parts.length > 0) candidates.push(`${tag}.${parts.join('.')}`);
      }
      const dataAttrs = Array.from(target.attributes)
        .filter((a) => a.name.startsWith('data-'))
        .slice(0, 2);
      if (dataAttrs.length > 0) {
        candidates.push(
          `${tag}${dataAttrs.map((a) => `[${a.name}="${a.value}"]`).join('')}`,
        );
      }
      const aria = target.getAttribute('aria-label');
      if (aria) candidates.push(`${tag}[aria-label="${aria}"]`);
      if (['button', 'a'].includes(tag) && target.textContent) {
        const t = target.textContent.trim().substring(0, 50);
        candidates.push(`${tag}:contains("${t}")`);
      }
      if (tag === 'input') {
        const type = target.getAttribute('type') || 'text';
        const name = target.getAttribute('name');
        candidates.push(name ? `input[name="${name}"]` : `input[type="${type}"]`);
      }
      const selector = candidates[0] || tag;
      const attrs: Record<string, string> = {};
      for (const name of [
        'id',
        'class',
        'name',
        'type',
        'href',
        'aria-label',
        'aria-description',
        'role',
        'title',
        'data-tooltip',
        'data-tip',
        'data-original-title',
        'data-testid',
        'placeholder',
        'alt',
        'value',
      ]) {
        const v = target.getAttribute(name);
        if (v) attrs[name] = v;
      }
      const elementInfo = {
        selector,
        tagName: tag,
        text: target.textContent?.trim().substring(0, 100) || '',
        attributes: attrs,
        boundingRect: {
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height,
          top: rect.top,
          right: rect.right,
          bottom: rect.bottom,
          left: rect.left,
        },
      };

      let typedText: string | undefined;
      let typedInElement: TypedInElement | undefined;
      if (keyBuf.length > 0 && focusedEl) {
        const fe = focusedEl as HTMLElement;
        typedText = keyBuf.join('');
        typedInElement = elementMeta(fe);
        keyBuf = [];
        focusedEl = null;
      }

      try {
        chrome.runtime.sendMessage({
          type: 'ELEMENT_SELECTION',
          elementInfo,
          url: window.location.href,
          viewportWidth: window.innerWidth,
          viewportHeight: window.innerHeight,
          needsScreenshot: true,
          clickCoordinates: { x: ev.clientX, y: ev.clientY },
          typedText,
          typedInElement,
        });
      } catch {
        /* ignore */
      }

      setTimeout(() => {
        try {
          if (typeof (target as HTMLElement).click === 'function') {
            (target as HTMLElement).click();
          } else {
            target.dispatchEvent(
              new MouseEvent('click', { view: window, bubbles: true, cancelable: true }),
            );
          }
        } catch {
          /* ignore */
        } finally {
          handling = false;
        }
      }, 300);
    } catch {
      handling = false;
    } finally {
      // One-shot click listener (official): remove click + escape; keystrokes may stay.
      document.removeEventListener('click', onClick, true);
      document.removeEventListener('keydown', onEscape, true);
      chrome.runtime.onMessage.removeListener(onCancelMsg);
      w.__clickListenerActive = false;
    }
  };

  function teardown(full: boolean = true) {
    document.removeEventListener('click', onClick, true);
    document.removeEventListener('keydown', onEscape, true);
    if (full) {
      document.removeEventListener('keydown', onKeydown, true);
      document.removeEventListener('focus', onFocus, true);
      document.removeEventListener('input', onInputOrPaste, true);
      document.removeEventListener('paste', onInputOrPaste, true);
      document.removeEventListener('compositionend', onCompositionEnd, true);
      w.__keystrokeListenersActive = false;
      if (w.__teachClaudeTeardown === teardown) {
        delete w.__teachClaudeTeardown;
      }
    }
    chrome.runtime.onMessage.removeListener(onCancelMsg);
    w.__clickListenerActive = false;
  }

  // Host cancel path can invoke this when tabs.sendMessage misses the listener.
  w.__teachClaudeTeardown = teardown;

  document.addEventListener('click', onClick, true);
  document.addEventListener('keydown', onEscape, true);
}

export async function injectElementSelector(tabId: number): Promise<ElementSelection | null> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value: ElementSelection | null) => {
      if (settled) return;
      settled = true;
      chrome.runtime.onMessage.removeListener(onMsg);
      clearTimeout(timer);
      resolve(value);
    };

    const onMsg = (
      msg: {
        type?: string;
        cancelled?: boolean;
        elementInfo?: ElementInfo;
        url?: string;
        viewportWidth?: number;
        viewportHeight?: number;
        clickCoordinates?: { x: number; y: number };
        typedText?: string;
        typedInElement?: TypedInElement;
      },
      sender: chrome.runtime.MessageSender,
    ) => {
      if (msg?.type === 'CANCEL_ELEMENT_SELECTOR') {
        finish(null);
        return;
      }
      if (msg?.type !== 'ELEMENT_SELECTION') return;
      if (sender.tab?.id !== undefined && sender.tab.id !== tabId) return;
      if (msg.cancelled) {
        finish(null);
        return;
      }
      if (!msg.elementInfo) return;
      finish({
        element: msg.elementInfo,
        url: msg.url || '',
        timestamp: Date.now(),
        tabId: sender.tab?.id ?? tabId,
        viewportWidth: msg.viewportWidth,
        viewportHeight: msg.viewportHeight,
        clickCoordinates: msg.clickCoordinates,
        typedText: msg.typedText,
        typedInElement: msg.typedInElement,
      });
    };

    chrome.runtime.onMessage.addListener(onMsg);
    const timer = setTimeout(() => finish(null), TIMEOUT_MS);

    void chrome.scripting
      .executeScript({
        target: { tabId },
        func: pageElementSelectorInstall,
      })
      .catch(() => finish(null));
  });
}

export async function cancelElementSelector(tabId: number): Promise<void> {
  try {
    await chrome.tabs.sendMessage(tabId, { type: 'CANCEL_ELEMENT_SELECTOR' });
  } catch {
    /* no listener — fall through to executeScript teardown */
  }
  // Always run host-side teardown: removes DOM listeners (not just flags).
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const w = window as Window & {
          __clickListenerActive?: boolean;
          __keystrokeListenersActive?: boolean;
          __teachClaudeTeardown?: (full?: boolean) => void;
        };
        try {
          w.__teachClaudeTeardown?.(true);
        } catch {
          /* ignore */
        }
        w.__clickListenerActive = false;
        w.__keystrokeListenersActive = false;
        delete w.__teachClaudeTeardown;
      },
    });
  } catch {
    /* ignore */
  }
}
