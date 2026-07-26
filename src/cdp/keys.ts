/**
 * 键名 → CDP Input.dispatchKeyEvent 参数的映射表。
 *
 * CDP 的键盘事件比看上去麻烦：光给 `key` 不够，网页里大量代码读的是
 * `keyCode` / `which`（老 API）或 `code`（物理键位）。三者不一致时，
 * React 的受控输入、快捷键库、富文本编辑器都会出现"按了没反应"。
 * 所以每个键都要给全 key / code / windowsVirtualKeyCode / nativeVirtualKeyCode。
 *
 * 参考 Chrome DevTools Protocol Input 域 + Windows Virtual-Key Codes。
 */

export interface KeyDefinition {
  key: string;
  code: string;
  keyCode: number;
  /** 该键是否产生可见字符（决定要不要发 char 事件） */
  text?: string;
  location?: number;
}

/** modifiers 位掩码 —— CDP 定义：Alt=1, Ctrl=2, Meta/Command=4, Shift=8 */
export const MODIFIER_BITS = {
  alt: 1,
  ctrl: 2,
  meta: 4,
  shift: 8,
} as const;

/** 用户可以写的修饰键别名 */
const MODIFIER_ALIASES: Record<string, keyof typeof MODIFIER_BITS> = {
  alt: 'alt',
  option: 'alt',
  opt: 'alt',
  ctrl: 'ctrl',
  control: 'ctrl',
  cmd: 'meta',
  command: 'meta',
  meta: 'meta',
  super: 'meta',
  win: 'meta',
  windows: 'meta',
  shift: 'shift',
};

export const NAMED_KEYS: Record<string, KeyDefinition> = {
  enter: { key: 'Enter', code: 'Enter', keyCode: 13, text: '\r' },
  return: { key: 'Enter', code: 'Enter', keyCode: 13, text: '\r' },
  tab: { key: 'Tab', code: 'Tab', keyCode: 9, text: '\t' },
  escape: { key: 'Escape', code: 'Escape', keyCode: 27 },
  esc: { key: 'Escape', code: 'Escape', keyCode: 27 },
  backspace: { key: 'Backspace', code: 'Backspace', keyCode: 8 },
  delete: { key: 'Delete', code: 'Delete', keyCode: 46 },
  del: { key: 'Delete', code: 'Delete', keyCode: 46 },
  space: { key: ' ', code: 'Space', keyCode: 32, text: ' ' },
  up: { key: 'ArrowUp', code: 'ArrowUp', keyCode: 38 },
  arrowup: { key: 'ArrowUp', code: 'ArrowUp', keyCode: 38 },
  down: { key: 'ArrowDown', code: 'ArrowDown', keyCode: 40 },
  arrowdown: { key: 'ArrowDown', code: 'ArrowDown', keyCode: 40 },
  left: { key: 'ArrowLeft', code: 'ArrowLeft', keyCode: 37 },
  arrowleft: { key: 'ArrowLeft', code: 'ArrowLeft', keyCode: 37 },
  right: { key: 'ArrowRight', code: 'ArrowRight', keyCode: 39 },
  arrowright: { key: 'ArrowRight', code: 'ArrowRight', keyCode: 39 },
  home: { key: 'Home', code: 'Home', keyCode: 36 },
  end: { key: 'End', code: 'End', keyCode: 35 },
  pageup: { key: 'PageUp', code: 'PageUp', keyCode: 33 },
  pagedown: { key: 'PageDown', code: 'PageDown', keyCode: 34 },
  insert: { key: 'Insert', code: 'Insert', keyCode: 45 },
  capslock: { key: 'CapsLock', code: 'CapsLock', keyCode: 20 },
  f1: { key: 'F1', code: 'F1', keyCode: 112 },
  f2: { key: 'F2', code: 'F2', keyCode: 113 },
  f3: { key: 'F3', code: 'F3', keyCode: 114 },
  f4: { key: 'F4', code: 'F4', keyCode: 115 },
  f5: { key: 'F5', code: 'F5', keyCode: 116 },
  f6: { key: 'F6', code: 'F6', keyCode: 117 },
  f7: { key: 'F7', code: 'F7', keyCode: 118 },
  f8: { key: 'F8', code: 'F8', keyCode: 119 },
  f9: { key: 'F9', code: 'F9', keyCode: 120 },
  f10: { key: 'F10', code: 'F10', keyCode: 121 },
  f11: { key: 'F11', code: 'F11', keyCode: 122 },
  f12: { key: 'F12', code: 'F12', keyCode: 123 },
};

/** 单字符 → code 的映射（美式键盘布局） */
function codeForChar(ch: string): string {
  if (/^[a-zA-Z]$/.test(ch)) return `Key${ch.toUpperCase()}`;
  if (/^[0-9]$/.test(ch)) return `Digit${ch}`;
  const punct: Record<string, string> = {
    '-': 'Minus',
    '=': 'Equal',
    '[': 'BracketLeft',
    ']': 'BracketRight',
    '\\': 'Backslash',
    ';': 'Semicolon',
    "'": 'Quote',
    '`': 'Backquote',
    ',': 'Comma',
    '.': 'Period',
    '/': 'Slash',
    ' ': 'Space',
  };
  return punct[ch] ?? '';
}

function keyCodeForChar(ch: string): number {
  if (/^[a-zA-Z]$/.test(ch)) return ch.toUpperCase().charCodeAt(0);
  if (/^[0-9]$/.test(ch)) return ch.charCodeAt(0);
  const punct: Record<string, number> = {
    '-': 189,
    '=': 187,
    '[': 219,
    ']': 221,
    '\\': 220,
    ';': 186,
    "'": 222,
    '`': 192,
    ',': 188,
    '.': 190,
    '/': 191,
    ' ': 32,
  };
  return punct[ch] ?? 0;
}

export interface ParsedKeystroke {
  modifiers: number;
  def: KeyDefinition;
}

/**
 * 禁止的快捷键。
 *
 * 页面缩放（cmd+= / ctrl+- / cmd+0）改的是浏览器 chrome 层的状态，不是页面状态。
 * 一旦改了，后续所有截图坐标和点击坐标全部错位，而且模型不会意识到这一点，
 * 会一直点空。直接拒掉，引导它用 zoom action（zoom 是在截图上裁剪+放大，不动页面）。
 */
const FORBIDDEN = [
  /^(cmd|command|meta|ctrl|control)\+[=+\-_0]$/i,
  /^(cmd|command|meta|ctrl|control)\+(plus|minus|equal)$/i,
];

export class KeyParseError extends Error {}

/**
 * 解析一个组合键，如 "cmd+shift+k" / "Enter" / "a"。
 */
export function parseKeystroke(raw: string): ParsedKeystroke {
  const spec = raw.trim();
  if (!spec) throw new KeyParseError('Empty key specification.');

  if (FORBIDDEN.some((re) => re.test(spec))) {
    throw new KeyParseError(
      `Page zoom shortcuts like "${spec}" are not supported because they desynchronise ` +
        `screenshot coordinates from click coordinates. Use the "zoom" action instead — ` +
        `it magnifies a region of the screenshot without changing the page.`,
    );
  }

  const parts = spec.split('+').map((p) => p.trim()).filter(Boolean);
  // 特例："+" 本身
  if (parts.length === 0) {
    return { modifiers: 0, def: { key: '+', code: 'Equal', keyCode: 187, text: '+' } };
  }

  let modifiers = 0;
  let keyPart = parts[parts.length - 1]!;

  for (const p of parts.slice(0, -1)) {
    const m = MODIFIER_ALIASES[p.toLowerCase()];
    if (!m) throw new KeyParseError(`Unknown modifier "${p}" in "${spec}".`);
    modifiers |= MODIFIER_BITS[m];
  }

  const named = NAMED_KEYS[keyPart.toLowerCase()];
  if (named) {
    // 带修饰键时不发 text —— 否则 cmd+a 会往输入框里插一个 "a"
    const def = modifiers === 0 ? named : { ...named, text: undefined };
    return { modifiers, def };
  }

  if (keyPart.length !== 1) {
    throw new KeyParseError(
      `Unknown key "${keyPart}". Use a single character, or one of: ` +
        `${Object.keys(NAMED_KEYS).slice(0, 20).join(', ')}…`,
    );
  }

  const isShifted = modifiers & MODIFIER_BITS.shift;
  const lower = keyPart.toLowerCase();
  const def: KeyDefinition = {
    key: isShifted ? keyPart.toUpperCase() : keyPart,
    code: codeForChar(lower),
    keyCode: keyCodeForChar(lower),
    // 只有纯按键（无 ctrl/cmd/alt）才产生字符
    text: modifiers & (MODIFIER_BITS.ctrl | MODIFIER_BITS.meta | MODIFIER_BITS.alt)
      ? undefined
      : isShifted
        ? keyPart.toUpperCase()
        : keyPart,
  };
  return { modifiers, def };
}

/** 解析空格分隔的按键序列，如 "Backspace Backspace Delete"。 */
export function parseKeySequence(raw: string): ParsedKeystroke[] {
  return raw
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map(parseKeystroke);
}
