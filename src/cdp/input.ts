/**
 * 鼠标 / 键盘输入。全部走 CDP Input 域。
 *
 * 为什么不用 chrome.scripting 注入 element.click()：
 *  - 合成的 DOM 事件带 isTrusted=false，很多站点（尤其是支付、登录）会忽略它
 *  - 不会触发真实的 hover / focus 链，下拉菜单、tooltip 之类的完全出不来
 *  - 不经过浏览器的命中测试，被遮挡的元素也能"点到"，与用户看到的画面不一致
 * CDP 的 Input.dispatch* 是在浏览器输入管线里注入的，isTrusted=true，行为与真人一致。
 */

import { send, ensureDomain } from './session';
import { parseKeySequence, parseKeystroke, MODIFIER_BITS, type ParsedKeystroke } from './keys';

export type MouseButton = 'left' | 'right' | 'middle';

const BUTTON_MASK: Record<MouseButton, number> = { left: 1, right: 2, middle: 4 };

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Official UPDATE_PHANTOM_CURSOR — best-effort visual only.
 * Lives here (not tools/tabs) so cdp never imports the tools layer.
 * Soft-retries inject once so the orange cursor still appears on tabs that
 * were open before the extension loaded (manifest CS never ran).
 */
async function movePhantomCursor(tabId: number, x: number, y: number): Promise<void> {
  const payload = { type: 'UPDATE_PHANTOM_CURSOR', x, y };
  try {
    await chrome.tabs.sendMessage(tabId, payload, { frameId: 0 });
    return;
  } catch {
    /* fall through to inject */
  }
  try {
    const manifest = chrome.runtime.getManifest();
    const files: string[] = [];
    for (const cs of manifest.content_scripts ?? []) {
      for (const js of cs.js ?? []) {
        if (/agentIndicator|agent-indicator|agent_indicator|agent-visual/i.test(js)) {
          files.push(js);
        }
      }
    }
    if (files.length === 0) files.push('src/content/agentIndicator.ts');
    // Prefer hashed dist asset over raw src path.
    files.sort((a, b) => (a.startsWith('assets/') ? 0 : 1) - (b.startsWith('assets/') ? 0 : 1));
    await chrome.scripting.executeScript({
      target: { tabId, frameIds: [0] },
      files: [files[0]!],
    });
    await new Promise((r) => setTimeout(r, 50));
    await chrome.tabs.sendMessage(tabId, payload, { frameId: 0 });
  } catch {
    /* chrome:// / still no CS — cursor is best-effort */
  }
}

/**
 * Official: slide phantom cursor + CDP mouseMoved.
 * Cursor animation is best-effort and must never block real input.
 */
export async function mouseMove(
  tabId: number,
  x: number,
  y: number,
  modifiers = 0,
): Promise<void> {
  // Kick off the visible cursor slide in parallel with the real move.
  const visual = movePhantomCursor(tabId, x, y);
  await send(tabId, 'Input.dispatchMouseEvent', {
    type: 'mouseMoved',
    x,
    y,
    button: 'none',
    buttons: 0,
    modifiers,
  });
  // Prefer letting the slide finish so users see the move (~180ms official).
  await Promise.race([visual, delay(220)]);
}

/**
 * 点击。
 *
 * 先 mouseMoved 再按下 —— 不这么做的话，依赖 hover 状态才显示的元素
 * （下拉菜单项、悬浮工具栏）会点不到，因为它们在 mousedown 那一刻还没渲染。
 * Official also waits for the phantom-cursor transition before press.
 */
export async function click(
  tabId: number,
  x: number,
  y: number,
  opts: { button?: MouseButton; clickCount?: number; modifiers?: number } = {},
): Promise<void> {
  const button = opts.button ?? 'left';
  const clickCount = opts.clickCount ?? 1;
  const modifiers = opts.modifiers ?? 0;
  const buttons = BUTTON_MASK[button];

  await mouseMove(tabId, x, y, modifiers);
  // 给 hover 效果一点时间落地
  await delay(16);

  for (let i = 1; i <= clickCount; i++) {
    await send(tabId, 'Input.dispatchMouseEvent', {
      type: 'mousePressed',
      x,
      y,
      button,
      buttons,
      clickCount: i,
      modifiers,
    });
    await send(tabId, 'Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      x,
      y,
      button,
      buttons: 0,
      clickCount: i,
      modifiers,
    });
    // 双击/三击的间隔必须小于系统 dblclick 阈值（~500ms），
    // 但也不能是 0，否则某些站点的去抖会把两次当成一次
    if (i < clickCount) await delay(40);
  }
}

/**
 * 拖拽。
 *
 * 中间必须插若干 mouseMoved —— HTML5 drag-and-drop 和几乎所有自研拖拽库
 * 都靠 mousemove 的连续事件来更新状态；只发 press → release 的话，
 * 对方会认为这是一次点击，拖拽完全不生效。
 */
export async function drag(
  tabId: number,
  from: [number, number],
  to: [number, number],
  opts: { steps?: number; modifiers?: number } = {},
): Promise<void> {
  const steps = Math.max(2, opts.steps ?? 12);
  const modifiers = opts.modifiers ?? 0;
  const [x0, y0] = from;
  const [x1, y1] = to;

  await mouseMove(tabId, x0, y0, modifiers);
  await send(tabId, 'Input.dispatchMouseEvent', {
    type: 'mousePressed',
    x: x0,
    y: y0,
    button: 'left',
    buttons: 1,
    clickCount: 1,
    modifiers,
  });

  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const x = Math.round(x0 + (x1 - x0) * t);
    const y = Math.round(y0 + (y1 - y0) * t);
    // Visual trail (non-blocking) + real drag path.
    void movePhantomCursor(tabId, x, y);
    await send(tabId, 'Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x,
      y,
      button: 'left',
      buttons: 1,
      modifiers,
    });
    await delay(12);
  }

  await send(tabId, 'Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    x: x1,
    y: y1,
    button: 'left',
    buttons: 0,
    clickCount: 1,
    modifiers,
  });
}

/** 一档滚轮 = 100px，跟 Chrome 默认一致。 */
const WHEEL_TICK_PX = 100;

export async function scroll(
  tabId: number,
  x: number,
  y: number,
  direction: 'up' | 'down' | 'left' | 'right',
  amount = 3,
): Promise<void> {
  const px = amount * WHEEL_TICK_PX;
  const deltaX = direction === 'left' ? -px : direction === 'right' ? px : 0;
  const deltaY = direction === 'up' ? -px : direction === 'down' ? px : 0;

  await send(tabId, 'Input.dispatchMouseEvent', {
    type: 'mouseWheel',
    x,
    y,
    deltaX,
    deltaY,
    button: 'none',
    buttons: 0,
    modifiers: 0,
  });
  // 滚动是异步的（平滑滚动 / IntersectionObserver 懒加载）
  await delay(120);
}

/**
 * 输入文本。
 *
 * 短文本逐字符 dispatch，长文本用 insertText。
 * 原因：insertText 快但不触发 keydown/keyup，很多"输入时搜索"、
 * 字数统计、表单校验都挂在 keydown 上，短输入用它会导致页面状态不更新。
 * 但长文本逐字符会非常慢（每字符 3 个 CDP 往返），所以给个阈值。
 */
const INSERT_TEXT_THRESHOLD = 30;

export async function typeText(tabId: number, text: string): Promise<void> {
  if (!text) return;

  if (text.length > INSERT_TEXT_THRESHOLD) {
    await send(tabId, 'Input.insertText', { text });
    return;
  }

  for (const ch of text) {
    if (ch === '\n') {
      await pressKey(tabId, parseKeystroke('Enter'));
      continue;
    }
    const { modifiers, def } = parseKeystroke(ch);
    await pressKey(tabId, { modifiers, def: { ...def, text: ch } });
  }
}

export async function pressKey(tabId: number, ks: ParsedKeystroke): Promise<void> {
  const { modifiers, def } = ks;

  const base = {
    modifiers,
    key: def.key,
    code: def.code,
    windowsVirtualKeyCode: def.keyCode,
    nativeVirtualKeyCode: def.keyCode,
    location: def.location ?? 0,
  };

  await send(tabId, 'Input.dispatchKeyEvent', {
    ...base,
    // 有可见字符时用 keyDown，否则 rawKeyDown —— CDP 要求如此，
    // 用错会导致 Enter 之类的键在 contenteditable 里插入空字符
    type: def.text ? 'keyDown' : 'rawKeyDown',
    text: def.text ?? '',
    unmodifiedText: def.text ?? '',
  });

  await send(tabId, 'Input.dispatchKeyEvent', {
    ...base,
    type: 'keyUp',
    text: '',
  });
}

/** 执行一个按键序列，可重复 N 次。 */
export async function pressKeys(tabId: number, spec: string, repeat = 1): Promise<void> {
  const seq = parseKeySequence(spec);
  const times = Math.min(Math.max(1, Math.floor(repeat)), 100);
  for (let i = 0; i < times; i++) {
    for (const ks of seq) {
      await pressKey(tabId, ks);
      await delay(8);
    }
  }
}

export { MODIFIER_BITS };

/** 把 "ctrl+shift" 这种修饰键字符串解析成位掩码（用于 click 的 modifiers 参数）。 */
export function parseModifiers(spec: string | undefined): number {
  if (!spec) return 0;
  let bits = 0;
  for (const part of spec.split('+').map((s) => s.trim().toLowerCase()).filter(Boolean)) {
    switch (part) {
      case 'ctrl':
      case 'control':
        bits |= MODIFIER_BITS.ctrl;
        break;
      case 'shift':
        bits |= MODIFIER_BITS.shift;
        break;
      case 'alt':
      case 'option':
      case 'opt':
        bits |= MODIFIER_BITS.alt;
        break;
      case 'cmd':
      case 'command':
      case 'meta':
      case 'win':
      case 'windows':
        bits |= MODIFIER_BITS.meta;
        break;
      default:
        throw new Error(
          `Unknown modifier "${part}". Supported: ctrl, shift, alt, cmd (meta), win.`,
        );
    }
  }
  return bits;
}

/** 确保 Input 域可用（Input 无需 enable，但要保证已 attach）。 */
export async function ensureInput(tabId: number): Promise<void> {
  await ensureDomain(tabId, 'Page');
}
