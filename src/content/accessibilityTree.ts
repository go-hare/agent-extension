/**
 * 页面内的可访问性树生成器。
 *
 * 为什么不用 CDP 的 Accessibility 域：
 *  - `Accessibility.getFullAXTree` 返回的是浏览器内部的 AX 节点，节点数常常上万，
 *    结构极其冗长（每个节点几十个属性），塞给模型 token 成本高得离谱
 *  - 拿不到稳定的元素句柄 —— AX nodeId 在 DOM 变动后会失效，
 *    而 agent 的典型流程是「读页面 → 思考 → 点某个元素」，中间必然有延迟
 *  - 无法做敏感字段脱敏（AX 树里密码框的 value 是明文）
 *
 * 所以自己在页面里遍历 DOM：
 *  - 输出是**缩进文本**，不是 JSON。同样的信息 token 少一半以上，
 *    而且模型对缩进结构的理解比嵌套 JSON 更好
 *  - 每个节点分配一个稳定的 `ref_N`，用 WeakRef 持有元素。
 *    WeakRef 的意义：元素被页面移除后我们不会阻止它被 GC，
 *    同时 deref() 返回 undefined 让我们知道这个 ref 失效了 ——
 *    这正好对应「模型拿着旧 ref 去点」的情况，可以给出准确的错误提示
 *  - 敏感字段（密码、信用卡、验证码）的 value 一律替换成 [value redacted]。
 *    这是硬性的 —— 页面内容会进模型上下文，进而可能出现在日志里
 *
 * 这个脚本在 document_start 注入且 all_frames=true，所以要非常轻量，
 * 不能有 import（bundler 会把它打成 IIFE），不能污染页面全局。
 */

// ─────────────────────── 全局挂载点 ───────────────────────
// 用 __agent 前缀避免和页面自身的变量撞车。

declare global {
  interface Window {
    __agentElementMap?: Record<string, WeakRef<Element>>;
    __agentElementReverseMap?: WeakMap<Element, string>;
    __agentRefCounter?: number;
    __agentGenerateTree?: typeof generateTree;
    __agentResolveRef?: typeof resolveRef;
    /** Prevents double onMessage when scripting re-injects this file. */
    __agentA11yBootstrapped?: boolean;
    /** Latest message handler — re-inject refreshes this without stacking listeners. */
    __agentA11yHandle?: (
      msg: { type?: string; [k: string]: unknown },
      sender: chrome.runtime.MessageSender,
      sendResponse: (r: unknown) => void,
    ) => boolean;
  }
}

interface TreeOptions {
  filter: 'all' | 'interactive';
  maxDepth: number;
  maxChars: number;
  refId: string | null;
}

interface TreeResult {
  pageContent: string;
  viewport: { width: number; height: number };
  error?: string;
}

/** 单次遍历的节点上限。超过说明页面异常巨大，继续遍历只会拖死页面。 */
const MAX_NODES = 10_000;

const TAG_ROLE: Record<string, string> = {
  a: 'link',
  button: 'button',
  select: 'combobox',
  textarea: 'textbox',
  h1: 'heading',
  h2: 'heading',
  h3: 'heading',
  h4: 'heading',
  h5: 'heading',
  h6: 'heading',
  img: 'image',
  nav: 'navigation',
  main: 'main',
  header: 'banner',
  footer: 'contentinfo',
  section: 'region',
  article: 'article',
  aside: 'complementary',
  form: 'form',
  table: 'table',
  ul: 'list',
  ol: 'list',
  li: 'listitem',
  label: 'label',
  dialog: 'dialog',
  details: 'group',
  summary: 'button',
  video: 'video',
  audio: 'audio',
  iframe: 'iframe',
};

const INPUT_TYPE_ROLE: Record<string, string> = {
  submit: 'button',
  button: 'button',
  reset: 'button',
  image: 'button',
  checkbox: 'checkbox',
  radio: 'radio',
  file: 'file input',
  range: 'slider',
  search: 'searchbox',
};

/**
 * 会导致 value 被脱敏的 autocomplete 值。
 * 覆盖密码、一次性验证码、以及信用卡的全部字段。
 */
const SENSITIVE_AUTOCOMPLETE = [
  'current-password',
  'new-password',
  'one-time-code',
  'cc-number',
  'cc-csc',
  'cc-exp',
  'cc-exp-month',
  'cc-exp-year',
  'cc-name',
];

const SKIP_TAGS = new Set(['script', 'style', 'meta', 'link', 'title', 'noscript', 'template']);

const INTERACTIVE_TAGS = new Set([
  'a',
  'button',
  'input',
  'select',
  'textarea',
  'details',
  'summary',
  'option',
]);

const LANDMARK_TAGS = new Set([
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'nav',
  'main',
  'header',
  'footer',
  'section',
  'article',
  'aside',
  'dialog',
]);

const REDACTED = '[value redacted]';

function roleOf(el: Element): string {
  const explicit = el.getAttribute('role');
  if (explicit) return explicit;

  const tag = el.tagName.toLowerCase();
  if (tag === 'input') {
    const type = (el.getAttribute('type') || 'text').toLowerCase();
    return INPUT_TYPE_ROLE[type] ?? 'textbox';
  }
  return TAG_ROLE[tag] ?? 'generic';
}

function isSensitive(el: Element): boolean {
  const type = (el.getAttribute('type') || '').toLowerCase();
  if (type === 'password' || type === 'hidden') return true;

  const ac = (el.getAttribute('autocomplete') || '').toLowerCase();
  if (ac && SENSITIVE_AUTOCOMPLETE.some((s) => ac.includes(s))) return true;

  // 一些站点不写 autocomplete，只写 name/id
  const hint = `${el.getAttribute('name') || ''} ${el.id || ''}`.toLowerCase();
  if (/(^|[^a-z])(password|passwd|pwd|cvv|cvc|otp|securitycode)([^a-z]|$)/.test(hint)) {
    return true;
  }
  return false;
}

/** 只取直接子文本节点，不含后代 —— 否则每个容器都会重复它所有子孙的文字。 */
function directText(el: Element): string {
  let out = '';
  for (const node of Array.from(el.childNodes)) {
    if (node.nodeType === Node.TEXT_NODE) out += node.textContent ?? '';
  }
  return out.trim();
}

function labelForId(id: string): string {
  if (!id) return '';
  try {
    const l = document.querySelector(`label[for="${CSS.escape(id)}"]`);
    return l ? directText(l) : '';
  } catch {
    return '';
  }
}

function accessibleName(el: Element): string {
  const tag = el.tagName.toLowerCase();

  // select：报告当前选中项
  if (tag === 'select') {
    const sel = el as HTMLSelectElement;
    if (isSensitive(el)) {
      return (
        el.getAttribute('aria-label')?.trim() ||
        el.getAttribute('title')?.trim() ||
        labelForId(el.id) ||
        REDACTED
      );
    }
    const opt = sel.querySelector('option[selected]') ?? sel.options[sel.selectedIndex];
    if (opt?.textContent) return opt.textContent.trim();
  }

  const aria = el.getAttribute('aria-label');
  if (aria?.trim()) return aria.trim();

  // aria-labelledby 引用的元素文本
  const labelledBy = el.getAttribute('aria-labelledby');
  if (labelledBy) {
    const parts = labelledBy
      .split(/\s+/)
      .map((id) => document.getElementById(id)?.textContent?.trim() ?? '')
      .filter(Boolean);
    if (parts.length) return parts.join(' ');
  }

  const placeholder = el.getAttribute('placeholder');
  if (placeholder?.trim()) return placeholder.trim();

  const title = el.getAttribute('title');
  if (title?.trim()) return title.trim();

  const alt = el.getAttribute('alt');
  if (alt?.trim()) return alt.trim();

  const byLabel = labelForId(el.id);
  if (byLabel) return byLabel;

  if (tag === 'input') {
    const input = el as HTMLInputElement;
    const type = (el.getAttribute('type') || '').toLowerCase();
    const valueAttr = el.getAttribute('value');
    if ((type === 'submit' || type === 'button') && valueAttr?.trim()) return valueAttr.trim();
    if (isSensitive(el)) return input.value ? REDACTED : '';
    if (input.value && input.value.length < 50 && input.value.trim()) return input.value.trim();
    return '';
  }

  if (tag === 'textarea') {
    const ta = el as HTMLTextAreaElement;
    if (isSensitive(el)) return ta.value ? REDACTED : '';
    if (ta.value && ta.value.length < 80) return ta.value.trim();
  }

  if (tag === 'button' || tag === 'a' || tag === 'summary' || tag === 'option') {
    const t = directText(el);
    if (t) return t;
    // 图标按钮：文字在子元素里
    const deep = (el.textContent ?? '').trim();
    if (deep && deep.length <= 40) return deep;
  }

  if (/^h[1-6]$/.test(tag)) {
    const t = (el.textContent ?? '').trim();
    if (t) return t.substring(0, 100);
  }

  if (tag === 'img') return '';

  const own = directText(el);
  if (own.length >= 3) {
    return own.length > 100 ? `${own.substring(0, 100)}...` : own;
  }
  return '';
}

function isVisible(el: Element): boolean {
  const style = window.getComputedStyle(el);
  if (style.display === 'none') return false;
  if (style.visibility === 'hidden' || style.visibility === 'collapse') return false;
  if (style.opacity === '0') return false;
  const he = el as HTMLElement;
  if (he.offsetWidth <= 0 && he.offsetHeight <= 0) {
    // inline 元素 offsetWidth 可能为 0 但仍可见
    const r = el.getBoundingClientRect();
    if (r.width <= 0 && r.height <= 0) return false;
  }
  return true;
}

function isInViewport(el: Element): boolean {
  const r = el.getBoundingClientRect();
  return (
    r.top < window.innerHeight && r.bottom > 0 && r.left < window.innerWidth && r.right > 0
  );
}

function isInteractive(el: Element): boolean {
  const tag = el.tagName.toLowerCase();
  if (INTERACTIVE_TAGS.has(tag)) return true;
  if (el.hasAttribute('onclick')) return true;
  if (el.hasAttribute('tabindex')) return true;
  if (el.getAttribute('contenteditable') === 'true' || el.getAttribute('contenteditable') === '')
    return true;
  const role = el.getAttribute('role');
  if (
    role &&
    ['button', 'link', 'checkbox', 'radio', 'menuitem', 'tab', 'switch', 'option', 'textbox'].includes(
      role,
    )
  )
    return true;
  // 常见的"整块可点"卡片
  if ((el as HTMLElement).style?.cursor === 'pointer') return true;
  return false;
}

function isLandmark(el: Element): boolean {
  return LANDMARK_TAGS.has(el.tagName.toLowerCase()) || el.hasAttribute('role');
}

function shouldInclude(el: Element, opts: TreeOptions): boolean {
  const tag = el.tagName.toLowerCase();
  if (SKIP_TAGS.has(tag)) return false;

  if (opts.filter !== 'all') {
    if (el.getAttribute('aria-hidden') === 'true') return false;
    if (!isVisible(el)) return false;
    // 只在没指定 refId 时做视口裁剪 —— 指定了就是要看那棵子树，
    // 哪怕它滚出了视口
    if (!opts.refId && !isInViewport(el)) return false;
  }

  if (opts.filter === 'interactive') return isInteractive(el);

  if (isInteractive(el)) return true;
  if (isLandmark(el)) return true;
  if (accessibleName(el).length > 0) return true;

  const role = roleOf(el);
  return role !== 'generic' && role !== 'image';
}

function ensureMaps(): void {
  if (!window.__agentElementMap) window.__agentElementMap = {};
  if (!window.__agentElementReverseMap) window.__agentElementReverseMap = new WeakMap();
  if (window.__agentRefCounter == null) window.__agentRefCounter = 0;
}

/**
 * 给元素分配 / 复用 ref。
 *
 * 复用很重要：模型读了一次页面拿到 ref_5，滚动后再读一次，
 * 同一个按钮应该还是 ref_5。否则模型会以为页面变了。
 */
function refFor(el: Element): string {
  ensureMaps();
  const map = window.__agentElementMap!;
  const reverse = window.__agentElementReverseMap!;

  const existing = reverse.get(el);
  if (existing) {
    // 校验正向表还指向同一个元素（元素被替换过就要重新分配）
    if (map[existing]?.deref() === el) return existing;
  }

  window.__agentRefCounter = (window.__agentRefCounter ?? 0) + 1;
  const ref = `ref_${window.__agentRefCounter}`;
  map[ref] = new WeakRef(el);
  reverse.set(el, ref);
  return ref;
}

function escapeQuotes(s: string): string {
  return s.replace(/\s+/g, ' ').substring(0, 100).replace(/"/g, '\\"');
}

function generateTree(raw: Partial<TreeOptions> = {}): TreeResult {
  const opts: TreeOptions = {
    filter: raw.filter ?? 'all',
    maxDepth: raw.maxDepth ?? 15,
    maxChars: raw.maxChars ?? 50_000,
    refId: raw.refId ?? null,
  };

  const viewport = { width: window.innerWidth, height: window.innerHeight };

  try {
    ensureMaps();
    const lines: string[] = [];
    let count = 0;

    const walk = (el: Element, depth: number): void => {
      if (count >= MAX_NODES) return;
      if (depth > opts.maxDepth) return;
      if (!el?.tagName) return;

      // 指定 refId 时根节点无条件包含
      const included = shouldInclude(el, opts) || (opts.refId != null && depth === 0);

      if (included) {
        const role = roleOf(el);
        const name = accessibleName(el);
        const ref = refFor(el);
        count++;

        let line = `${' '.repeat(depth)}${role}`;
        if (name) line += ` "${escapeQuotes(name)}"`;
        line += ` [${ref}]`;

        const href = el.getAttribute('href');
        if (href) line += ` href="${href.substring(0, 120)}"`;
        const type = el.getAttribute('type');
        if (type) line += ` type="${type}"`;
        const ph = el.getAttribute('placeholder');
        if (ph) line += ` placeholder="${escapeQuotes(ph)}"`;
        if (el.hasAttribute('disabled') || el.getAttribute('aria-disabled') === 'true') {
          line += ' (disabled)';
        }
        if (el.getAttribute('aria-expanded')) {
          line += ` (expanded=${el.getAttribute('aria-expanded')})`;
        }
        if ((el as HTMLInputElement).checked) line += ' (checked)';

        lines.push(line);

        // select 的选项要展开，否则模型不知道有哪些值可选
        if (el.tagName.toLowerCase() === 'select' && !isSensitive(el)) {
          const sel = el as HTMLSelectElement;
          for (const opt of Array.from(sel.options)) {
            let o = `${' '.repeat(depth + 1)}option`;
            const t = opt.textContent?.trim();
            if (t) o += ` "${escapeQuotes(t)}"`;
            if (opt.selected) o += ' (selected)';
            if (opt.value && opt.value !== t) o += ` value="${escapeQuotes(opt.value)}"`;
            lines.push(o);
          }
        }
      }

      // select 的子节点已经手动处理了；敏感 select 干脆不下钻
      if (el.tagName.toLowerCase() === 'select') return;

      if (depth < opts.maxDepth) {
        for (const child of Array.from(el.children)) {
          walk(child, included ? depth + 1 : depth);
        }
      }
    };

    if (opts.refId) {
      const holder = window.__agentElementMap![opts.refId];
      if (!holder) {
        return {
          pageContent: '',
          viewport,
          error:
            `Element "${opts.refId}" was never seen on this page. ` +
            `Call read_page without ref_id to get current element references.`,
        };
      }
      const el = holder.deref();
      if (!el) {
        return {
          pageContent: '',
          viewport,
          error:
            `Element "${opts.refId}" no longer exists — the page removed or replaced it. ` +
            `Call read_page again to get fresh element references.`,
        };
      }
      walk(el, 0);
    } else if (document.body) {
      walk(document.body, 0);
    }

    // 清掉已经被 GC 的 ref，防止 map 无限增长
    const map = window.__agentElementMap!;
    for (const k of Object.keys(map)) {
      if (!map[k]!.deref()) delete map[k];
    }

    let content = lines.join('\n');

    if (count >= MAX_NODES) {
      content +=
        `\n[truncated at ${MAX_NODES} elements — this page is very large. ` +
        (opts.refId
          ? 'Reduce max_depth, or target a more specific child element.'
          : 'Pass a ref_id to focus on a subtree, or reduce max_depth.') +
        ']';
    }

    if (content.length > opts.maxChars) {
      const total = content.length;
      let cut = content.lastIndexOf('\n', opts.maxChars);
      if (cut <= 0) cut = opts.maxChars;
      content =
        `${content.slice(0, cut)}\n[output truncated at ${opts.maxChars} of ${total} characters. ` +
        `Pass a larger max_chars, or ` +
        (opts.refId ? 'target a smaller subtree' : 'pass a ref_id to focus') +
        '.]';
    }

    return { pageContent: content, viewport };
  } catch (e) {
    return {
      pageContent: '',
      viewport,
      error: `Error generating accessibility tree: ${e instanceof Error ? e.message : 'Unknown error'}`,
    };
  }
}

/** ref → 视口坐标（中心点）。给 computer 的 ref 点击和 scroll_to 用。 */
function resolveRef(refId: string): {
  ok: boolean;
  error?: string;
  center?: [number, number];
  rect?: { x: number; y: number; width: number; height: number };
  inViewport?: boolean;
} {
  ensureMaps();
  const holder = window.__agentElementMap![refId];
  if (!holder) {
    return {
      ok: false,
      error: `Element "${refId}" was never seen on this page. Call read_page first.`,
    };
  }
  const el = holder.deref();
  if (!isLiveElement(el)) {
    return {
      ok: false,
      error: `Element "${refId}" no longer exists. Call read_page again for fresh references.`,
    };
  }

  const r = el.getBoundingClientRect();
  if (r.width === 0 && r.height === 0) {
    return {
      ok: false,
      error: `Element "${refId}" has zero size — it is probably hidden. Try read_page again.`,
    };
  }

  const inViewport =
    r.top < window.innerHeight && r.bottom > 0 && r.left < window.innerWidth && r.right > 0;

  return {
    ok: true,
    center: [Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2)],
    rect: { x: r.left, y: r.top, width: r.width, height: r.height },
    inViewport,
  };
}

/** 把 ref 指向的元素滚进视口。 */
function scrollRefIntoView(refId: string): { ok: boolean; error?: string } {
  ensureMaps();
  const el = window.__agentElementMap![refId]?.deref();
  if (!isLiveElement(el)) {
    return { ok: false, error: `Element "${refId}" no longer exists. Call read_page again.` };
  }
  el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' as ScrollBehavior });
  return { ok: true };
}

/**
 * Alive check for a WeakRef target.
 * Prefer `isConnected` over `document.contains` — the latter is false for
 * nodes inside (open) shadow roots even when the element is still live.
 */
function isLiveElement(el: Element | undefined | null): el is Element {
  if (!el) return false;
  // isConnected covers light DOM + shadow trees.
  if (typeof el.isConnected === 'boolean') return el.isConnected;
  return document.contains(el);
}

/**
 * form_input via ref — MUST run in the isolated world that owns __agentElementMap.
 * (Earlier form_input used executeScript world:'MAIN', which cannot see content-script
 * maps → always "Element ref_N no longer exists".)
 */
function formInputByRef(
  refId: string,
  value: string | number | boolean,
): { ok: boolean; error?: string; detail?: string } {
  ensureMaps();
  const holder = window.__agentElementMap![refId];
  if (!holder) {
    return {
      ok: false,
      error: `Element "${refId}" was never seen on this page. Call read_page first.`,
    };
  }
  const el = holder.deref() as
    | HTMLInputElement
    | HTMLTextAreaElement
    | HTMLSelectElement
    | HTMLElement
    | undefined;
  if (!isLiveElement(el)) {
    return {
      ok: false,
      error: `Element "${refId}" no longer exists. Call read_page again for fresh references.`,
    };
  }

  const tag = el.tagName.toLowerCase();
  const type = (el as HTMLInputElement).type?.toLowerCase?.() ?? '';

  // React/Vue listen to the native value setter, not plain property assign.
  const setNative = (node: HTMLElement, prop: string, v: unknown) => {
    // Walk prototype chain — React 16+ installs the tracker on HTMLInputElement.prototype.
    let proto: object | null = Object.getPrototypeOf(node) as object | null;
    while (proto && proto !== Object.prototype) {
      const desc = Object.getOwnPropertyDescriptor(proto, prop);
      if (desc?.set) {
        desc.set.call(node, v);
        return;
      }
      proto = Object.getPrototypeOf(proto) as object | null;
    }
    (node as unknown as Record<string, unknown>)[prop] = v;
  };

  const fire = (node: HTMLElement, text?: string) => {
    // Prefer InputEvent so frameworks that check event instanceof InputEvent still update.
    try {
      node.dispatchEvent(
        new InputEvent('input', {
          bubbles: true,
          cancelable: true,
          data: text ?? null,
          inputType: 'insertText',
        }),
      );
    } catch {
      node.dispatchEvent(new Event('input', { bubbles: true }));
    }
    node.dispatchEvent(new Event('change', { bubbles: true }));
  };

  try {
    try {
      el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' as ScrollBehavior });
    } catch {
      el.scrollIntoView({ block: 'center', inline: 'center' });
    }

    if (tag === 'select') {
      const sel = el as HTMLSelectElement;
      const want = String(value).toLowerCase().trim();
      const opt =
        [...sel.options].find((o) => o.value.toLowerCase() === want) ??
        [...sel.options].find((o) => o.text.trim().toLowerCase() === want) ??
        [...sel.options].find((o) => o.text.trim().toLowerCase().includes(want));
      if (!opt) {
        return {
          ok: false,
          error:
            `No option matching "${value}". Available: ` +
            [...sel.options].map((o) => o.text.trim()).join(' | '),
        };
      }
      sel.focus();
      setNative(sel, 'value', opt.value);
      // Also set selectedIndex — some libs only watch that.
      sel.selectedIndex = opt.index;
      fire(sel);
      return { ok: true, detail: `selected "${opt.text.trim()}"` };
    }

    if (type === 'checkbox' || type === 'radio') {
      const box = el as HTMLInputElement;
      const want =
        typeof value === 'boolean'
          ? value
          : !/^(false|0|no|off|unchecked)$/i.test(String(value));
      if (box.checked !== want) {
        // click() flips and fires the full trusted-ish listener chain in the page.
        box.click();
        // If a preventDefault handler blocked the flip, force it via native setter.
        if (box.checked !== want) {
          setNative(box, 'checked', want);
          fire(box);
        }
      }
      return { ok: true, detail: want ? 'checked' : 'unchecked' };
    }

    if ((el as HTMLElement).isContentEditable) {
      el.focus();
      // Select-all + insert so React controlled contenteditables often pick it up.
      const text = String(value);
      try {
        const range = document.createRange();
        range.selectNodeContents(el);
        const sel = window.getSelection();
        sel?.removeAllRanges();
        sel?.addRange(range);
      } catch {
        /* ignore */
      }
      el.textContent = text;
      fire(el, text);
      return { ok: true, detail: 'set contenteditable text' };
    }

    // text / number / email / password / textarea / etc.
    const input = el as HTMLInputElement | HTMLTextAreaElement;
    const text = String(value);
    input.focus();
    // Clear then set — matches user replace-all and trips more onChange handlers.
    setNative(input, 'value', '');
    setNative(input, 'value', text);
    try {
      // Keep cursor at end for sites that read selectionStart on input.
      const len = text.length;
      input.setSelectionRange?.(len, len);
    } catch {
      /* not all input types support selection */
    }
    fire(input, text);
    return { ok: true, detail: 'set value' };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Deliver FileList / drop to a ref target — same isolated world as __agentElementMap.
 * Coordinate-only drops still go through MAIN via upload.ts; ref path must be here.
 */
function deliverFilesByRef(
  refId: string,
  filePayloads: Array<{ data: string; name: string; mimeType: string }>,
): { ok: boolean; error?: string; detail?: string } {
  ensureMaps();
  const holder = window.__agentElementMap![refId];
  if (!holder) {
    return {
      ok: false,
      error: `Element "${refId}" was never seen on this page. Call read_page first.`,
    };
  }
  const el = holder.deref();
  if (!isLiveElement(el)) {
    return {
      ok: false,
      error: `Element "${refId}" no longer exists. Call read_page again for fresh references.`,
    };
  }

  try {
    const dt = new DataTransfer();
    for (const f of filePayloads) {
      const bin = atob(f.data);
      const arr = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
      const copy = new Uint8Array(arr.byteLength);
      copy.set(arr);
      const blob = new Blob([copy], { type: f.mimeType || 'application/octet-stream' });
      dt.items.add(new File([blob], f.name, { type: f.mimeType || 'application/octet-stream' }));
    }

    try {
      el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' as ScrollBehavior });
    } catch {
      el.scrollIntoView({ block: 'center', inline: 'center' });
    }

    const input =
      el instanceof HTMLInputElement && el.type === 'file'
        ? el
        : ((el as HTMLElement).querySelector?.('input[type="file"]') as HTMLInputElement | null) ??
          ((el as HTMLElement).closest?.('input[type="file"]') as HTMLInputElement | null);

    if (input && input.type === 'file') {
      try {
        input.files = dt.files;
      } catch (e) {
        return {
          ok: false,
          error: `Could not assign files to input: ${e instanceof Error ? e.message : String(e)}`,
        };
      }
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      return {
        ok: true,
        detail: `Set ${dt.files.length} file(s) on <input type="file"> (${refId}).`,
      };
    }

    const rect = el.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const common: DragEventInit = {
      bubbles: true,
      cancelable: true,
      clientX: cx,
      clientY: cy,
      dataTransfer: dt,
    };
    for (const type of ['dragenter', 'dragover', 'drop'] as const) {
      el.dispatchEvent(new DragEvent(type, common));
    }
    return {
      ok: true,
      detail: `Dispatched drop with ${dt.files.length} file(s) on ${refId} at (${Math.round(cx)}, ${Math.round(cy)}).`,
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * 抽取页面正文。
 *
 * 用于 get_page_text —— 模型只想读文章内容时，a11y 树太吵。
 * 优先找 <main> / <article>，退化到 body 但剔除导航、页脚、侧栏、广告。
 */
function extractText(maxChars = 50_000): { text: string; title: string; url: string } {
  const NOISE = 'nav, header, footer, aside, script, style, noscript, [role="navigation"], [role="banner"], [role="contentinfo"], [aria-hidden="true"]';

  const pick =
    document.querySelector('main') ??
    document.querySelector('article') ??
    document.querySelector('[role="main"]') ??
    document.body;

  const clone = pick.cloneNode(true) as HTMLElement;
  clone.querySelectorAll(NOISE).forEach((n) => n.remove());
  // 密码等敏感输入的值不该出现在正文里
  clone.querySelectorAll('input, textarea').forEach((n) => {
    if (isSensitive(n)) n.setAttribute('value', REDACTED);
  });

  let text = (clone.innerText ?? clone.textContent ?? '')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();

  if (text.length > maxChars) {
    text = `${text.slice(0, maxChars)}\n[truncated at ${maxChars} of ${text.length} characters]`;
  }

  return { text, title: document.title, url: location.href };
}

// ─────────────────────── 消息接口 ───────────────────────

// 暴露给同页面的其它注入脚本（调试用），主通路走 message。
// Always refresh function pointers so a re-inject picks up bugfixes without
// stacking another onMessage listener (maps/refs stay on window).
window.__agentGenerateTree = generateTree;
window.__agentResolveRef = resolveRef;

interface Request {
  type: string;
  requestId?: string;
  options?: Partial<TreeOptions>;
  refId?: string;
  maxChars?: number;
  value?: string | number | boolean;
  files?: Array<{ data: string; name: string; mimeType: string }>;
}

function handleA11yMessage(
  msg: Request,
  _sender: chrome.runtime.MessageSender,
  sendResponse: (r: unknown) => void,
): boolean {
  switch (msg?.type) {
    case 'AGENT_PING':
      sendResponse({ ok: true, frame: window === window.top ? 'top' : 'child', url: location.href });
      return false;

    case 'AGENT_GENERATE_TREE':
      sendResponse(generateTree(msg.options));
      return false;

    case 'AGENT_RESOLVE_REF':
      sendResponse(resolveRef(msg.refId ?? ''));
      return false;

    case 'AGENT_SCROLL_REF':
      sendResponse(scrollRefIntoView(msg.refId ?? ''));
      return false;

    case 'AGENT_FORM_INPUT':
      sendResponse(formInputByRef(msg.refId ?? '', msg.value as string | number | boolean));
      return false;

    case 'AGENT_DELIVER_FILES':
      sendResponse(deliverFilesByRef(msg.refId ?? '', msg.files ?? []));
      return false;

    case 'AGENT_EXTRACT_TEXT':
      sendResponse(extractText(msg.maxChars));
      return false;

    default:
      return false;
  }
}

// Always point at the latest handler (re-inject picks up bugfixes).
// Only register ONE chrome listener — stacking them races sendResponse.
window.__agentA11yHandle = (msg, sender, sendResponse) =>
  handleA11yMessage(msg as Request, sender, sendResponse);
if (!window.__agentA11yBootstrapped) {
  window.__agentA11yBootstrapped = true;
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    const h = window.__agentA11yHandle;
    if (!h) return false;
    return h(msg as { type?: string; [k: string]: unknown }, sender, sendResponse);
  });
}

export {};
