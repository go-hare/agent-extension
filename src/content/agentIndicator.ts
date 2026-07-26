/**
 * "Agent 正在操作此页面" 的视觉指示器。
 *
 * 这不是装饰 —— 它是安全设计的一部分：
 * agent 用 CDP 注入的是 **isTrusted=true 的真实输入事件**，
 * 从页面的角度和真人操作完全无法区分。用户必须能一眼看出
 * 现在动页面的是 AI 不是自己，否则后台标签页里的自动操作
 * 会变成"我什么时候点的这个按钮"。
 *
 * 实现要点：
 *  - Shadow DOM 隔离：页面的 CSS reset 冲不掉我们，我们也污染不到页面。
 *    用 closed 模式并自己留引用 —— 页面脚本拿不到 shadowRoot，
 *    也就没法伪造/隐藏这个指示器。
 *  - pointer-events: none —— 绝不能挡住 agent 自己要点的元素。
 *  - z-index 2147483646（留一格给页面自己的极端值，我们不需要赢到底，
 *    真被盖住时用户至少还能看到边框）。
 */

const HOST_ID = '__agent_activity_indicator__';

const SHADOW_CSS = `
  :host { all: initial; }
  .frame {
    position: fixed; inset: 0;
    border: 2px solid hsl(15 63.1% 59.6%);
    box-shadow: inset 0 0 0 1px hsl(15 63.1% 59.6% / .35);
    pointer-events: none; opacity: 0;
    transition: opacity .18s ease-out;
  }
  .frame[data-on="1"] { opacity: 1; }
  .pill {
    position: fixed; top: 10px; left: 50%;
    transform: translateX(-50%) translateY(-8px);
    display: flex; align-items: center; gap: 8px;
    max-width: min(420px, 80vw); padding: 6px 12px;
    border-radius: 999px;
    background: hsl(60 2.6% 7.6% / .92);
    color: hsl(48 33.3% 97.1%);
    font: 500 12px/1.4 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    letter-spacing: .1px;
    box-shadow: 0 4px 14px hsl(0 0% 0% / .28);
    opacity: 0; pointer-events: none;
    transition: opacity .18s ease-out, transform .18s ease-out;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .pill[data-on="1"] { opacity: 1; transform: translateX(-50%) translateY(0); }
  .dot {
    width: 7px; height: 7px; border-radius: 50%;
    background: hsl(15 63.1% 59.6%); flex: 0 0 auto;
    animation: agent-pulse 1.4s ease-in-out infinite;
  }
  @keyframes agent-pulse {
    0%, 100% { opacity: 1; transform: scale(1); }
    50%      { opacity: .45; transform: scale(.8); }
  }
  @media (prefers-reduced-motion: reduce) { .dot { animation: none; } }
`;

interface Ui {
  host: HTMLElement;
  frame: HTMLElement;
  pill: HTMLElement;
  label: HTMLElement;
}

let ui: Ui | null = null;
let hideTimer: number | undefined;

function build(): Ui {
  const host = document.createElement('div');
  host.id = HOST_ID;
  host.style.cssText =
    'position:fixed;inset:0;pointer-events:none;z-index:2147483646;contain:layout style size';

  const root = host.attachShadow({ mode: 'closed' });

  const style = document.createElement('style');
  style.textContent = SHADOW_CSS;

  const frame = document.createElement('div');
  frame.className = 'frame';

  const pill = document.createElement('div');
  pill.className = 'pill';
  const dot = document.createElement('span');
  dot.className = 'dot';
  const label = document.createElement('span');
  label.textContent = 'Agent is working…';
  pill.append(dot, label);

  root.append(style, frame, pill);
  return { host, frame, pill, label };
}

function mount(): Ui {
  // document_idle 注入，但页面可能是 SPA 把整个 documentElement 换掉了
  if (ui && document.documentElement.contains(ui.host)) return ui;
  ui = build();
  document.documentElement.appendChild(ui.host);
  return ui;
}

function setOn(on: boolean, label?: string): void {
  const u = mount();
  if (label) u.label.textContent = label;
  const v = on ? '1' : '0';
  u.frame.setAttribute('data-on', v);
  u.pill.setAttribute('data-on', v);
}

function show(label?: string): void {
  if (hideTimer) {
    clearTimeout(hideTimer);
    hideTimer = undefined;
  }
  setOn(true, label);
}

/**
 * 延迟隐藏 —— 连续的工具调用之间有几十毫秒空隙，
 * 立即隐藏会让指示器疯狂闪烁，比不显示还糟。
 */
function hide(): void {
  if (hideTimer) clearTimeout(hideTimer);
  hideTimer = window.setTimeout(() => {
    setOn(false);
    hideTimer = undefined;
  }, 400);
}

chrome.runtime.onMessage.addListener((msg: { type?: string; label?: string }) => {
  if (msg?.type === 'AGENT_INDICATOR_SHOW') show(msg.label);
  else if (msg?.type === 'AGENT_INDICATOR_HIDE') hide();
  return false;
});

export {};
