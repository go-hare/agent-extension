/**
 * 工具的展示元数据：图标 + 人话标签。
 *
 * 单独一个文件而不是塞进 registry：registry 会被 service worker 侧的代码
 * 间接引用，而这里 import 了 React 组件。让 SW 去解析一堆 React 组件是纯浪费，
 * 也容易在 SW 里踩到 `document` 未定义。
 *
 * 文案风格**照抄原版**：用祈使式短语（"Click"、"Read page"、"Take screenshot"），
 * 不用进行时（"Clicking…"）。原版 1.0.81 的 bundle 里进行时形式只出现在
 * system prompt 的"反面例子"列表里，不是 UI 文案 —— 抄错了会一眼看出不是同一个产品。
 */

import {
  Camera,
  Code,
  ExternalLink,
  FileText,
  Globe,
  Keyboard,
  ListChecks,
  MousePointerClick,
  MoveHorizontal,
  Network,
  Search,
  SquareDashed,
  Terminal,
  Type,
  X,
  type LucideIcon,
} from './components/icons';

export interface ToolDisplay {
  Icon: LucideIcon;
  label: string;
}

/** 入参未知时的兜底标签。 */
const TABLE: Record<string, ToolDisplay> = {
  computer: { Icon: MousePointerClick, label: 'Computer action' },
  read_page: { Icon: FileText, label: 'Read page' },
  find: { Icon: Search, label: 'Find element' },
  get_page_text: { Icon: FileText, label: 'Extract page text' },
  form_input: { Icon: Keyboard, label: 'Set form value' },
  navigate: { Icon: Globe, label: 'Navigate' },
  tabs_context: { Icon: SquareDashed, label: 'List tabs' },
  tabs_create: { Icon: ExternalLink, label: 'Open tab' },
  tabs_close: { Icon: X, label: 'Close tab' },
  read_console_messages: { Icon: Terminal, label: 'Read console' },
  read_network_requests: { Icon: Network, label: 'Read network requests' },
  javascript_tool: { Icon: Code, label: 'Run JavaScript' },
  resize_window: { Icon: MoveHorizontal, label: 'Resize window' },
  update_plan: { Icon: ListChecks, label: 'Update plan' },
  todowrite: { Icon: ListChecks, label: 'Update checklist' },
};

const FALLBACK: ToolDisplay = { Icon: Terminal, label: 'Tool' };

/**
 * `computer` 的动作细分。
 *
 * computer 一个工具下面有 13 个动作，只显示 "Computer action" 信息量太低 ——
 * 用户分不清 agent 是在截图还是在点"确认付款"。这是**安全相关**的：
 * 用户必须能一眼看出发生了什么，否则授权 UI 形同虚设。
 */
const COMPUTER_ICON: Record<string, LucideIcon> = {
  screenshot: Camera,
  type: Type,
  key: Keyboard,
  zoom: Search,
};

/**
 * 算出一次工具调用的展示文案。
 *
 * 有意**只读入参的已知字段**，不把整个 input 拼进标题：
 * 入参可能来自页面内容（比如 type 的文本、click 的目标名），直接渲染等于把
 * 页面文字提升成 UI 文案，是一条注入路径。所以只取受控的短片段，长度截断，
 * 剩下的交给 React 自动转义。
 */
export function describeCall(name: string, input: unknown): ToolDisplay {
  const args = (input ?? {}) as Record<string, unknown>;

  if (name === 'computer') return describeComputer(args);

  const base = TABLE[name] ?? FALLBACK;

  switch (name) {
    case 'read_page': {
      const f = args.filter;
      if (f === 'interactive') return { ...base, label: 'Read page (interactive)' };
      if (f === 'all') return { ...base, label: 'Read page (all)' };
      return base;
    }
    case 'find':
      return str(args.query)
        ? { ...base, label: `Find: “${truncate(str(args.query)!, 30)}”` }
        : base;
    case 'navigate':
      return str(args.url)
        ? { ...base, label: `Navigate to ${truncate(shortUrl(str(args.url)!), 30)}` }
        : base;
    case 'tabs_create':
      return str(args.url)
        ? { ...base, label: `Open tab: ${truncate(shortUrl(str(args.url)!), 30)}` }
        : base;
    case 'form_input': {
      const fields = Array.isArray(args.fields) ? args.fields.length : 0;
      if (fields === 0) return base;
      return { ...base, label: `Set ${fields} form field${fields === 1 ? '' : 's'}` };
    }
    case 'read_console_messages':
      return str(args.level) && args.level !== 'all'
        ? { ...base, label: `Read console (${str(args.level)})` }
        : base;
    default:
      return base;
  }
}

function describeComputer(args: Record<string, unknown>): ToolDisplay {
  const action = str(args.action) ?? '';
  const Icon = COMPUTER_ICON[action] ?? MousePointerClick;

  const label = ((): string => {
    switch (action) {
      case 'screenshot':
        return 'Take screenshot';
      case 'left_click':
        return target(args) ? `Click: ${target(args)}` : 'Click';
      case 'right_click':
        return 'Right-click';
      case 'middle_click':
        return 'Middle-click';
      case 'double_click':
        return 'Double-click';
      case 'triple_click':
        return 'Triple-click';
      case 'left_click_drag':
        return 'Drag';
      case 'type':
        return str(args.text) ? `Type: “${truncate(str(args.text)!, 30)}”` : 'Type text';
      case 'key':
        return str(args.text) ? `Press key: ${truncate(str(args.text)!, 30)}` : 'Press key';
      case 'scroll':
        return str(args.scroll_direction)
          ? `Scroll ${str(args.scroll_direction)}`
          : 'Scroll';
      case 'scroll_to':
        return target(args) ? `Scroll to: ${target(args)}` : 'Scroll to element';
      case 'wait': {
        const d = typeof args.duration === 'number' ? args.duration : undefined;
        if (d === undefined) return 'Wait';
        return `Wait ${d} second${d === 1 ? '' : 's'}`;
      }
      case 'zoom':
        return 'Zoom in';
      default:
        return `Computer action: ${action || 'Unknown'}`;
    }
  })();

  return { Icon, label };
}

/** 点击/滚动的目标描述：ref 优先于坐标（ref 是稳定的，坐标只在当次截图里有意义）。 */
function target(args: Record<string, unknown>): string | undefined {
  const ref = str(args.ref);
  if (ref) return ref;
  const c = args.coordinate;
  if (Array.isArray(c) && c.length === 2 && typeof c[0] === 'number' && typeof c[1] === 'number') {
    return `(${c[0]}, ${c[1]})`;
  }
  return undefined;
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() !== '' ? v : undefined;
}

export function shortUrl(url: string): string {
  try {
    const u = new URL(url);
    const path = u.pathname === '/' ? '' : u.pathname;
    return `${u.hostname}${path}`;
  } catch {
    return url;
  }
}

export function truncate(s: string, max: number): string {
  const flat = s.replace(/\s+/g, ' ').trim();
  return flat.length <= max ? flat : `${flat.slice(0, max)}...`;
}
