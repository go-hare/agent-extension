/**
 * Tool display metadata: icon + human label.
 *
 * Labels mirror official W() in sidepanel-CEYFzMrx.js (KC helper) and the
 * 1.0.81 locale packs — imperative phrases ("Click", "Read page"), never
 * progressive ("Clicking…"). Pass `t` from useUi() so ZH packs match.
 *
 * Kept out of registry so the service worker never pulls React icons.
 */

import type { UiStrings } from '@/i18n/ui';
import {
  Camera,
  Code,
  ExternalLink,
  FileText,
  FormIcon,
  Globe,
  Keyboard,
  Layers,
  ListChecks,
  MousePointerClick,
  MoveHorizontal,
  Network,
  Search,
  SquareDashed,
  Terminal,
  Type,
  Upload,
  X,
  type LucideIcon,
} from './components/icons';

export interface ToolDisplay {
  Icon: LucideIcon;
  label: string;
}

/** English TABLE fallbacks when describeCall is called without `t`. */
const TABLE: Record<string, ToolDisplay> = {
  computer: { Icon: MousePointerClick, label: 'Computer action' },
  read_page: { Icon: FileText, label: 'Read page' },
  find: { Icon: Search, label: 'Find element' },
  get_page_text: { Icon: FileText, label: 'Extract page text' },
  form_input: { Icon: FormIcon, label: 'Set form value' },
  navigate: { Icon: Globe, label: 'Navigate' },
  tabs_context: { Icon: SquareDashed, label: 'Get tabs' },
  tabs_create: { Icon: ExternalLink, label: 'Create new tab' },
  tabs_close: { Icon: X, label: 'Close tab' },
  // MCP tab tools (open Desktop / Claude Code bridge)
  tabs_context_mcp: { Icon: SquareDashed, label: 'Get MCP tabs' },
  tabs_create_mcp: { Icon: ExternalLink, label: 'Create MCP tab' },
  tabs_close_mcp: { Icon: X, label: 'Close MCP tab' },
  read_console_messages: { Icon: Terminal, label: 'Read console' },
  read_network_requests: { Icon: Network, label: 'Read network requests' },
  javascript_tool: { Icon: Code, label: 'Execute JavaScript' },
  resize_window: { Icon: MoveHorizontal, label: 'Resize window' },
  update_plan: { Icon: ListChecks, label: 'Plan' },
  todowrite: { Icon: ListChecks, label: 'Steps' },
  browser_batch: { Icon: Layers, label: 'Batch' },
  upload_image: { Icon: Upload, label: 'Upload image' },
  file_upload: { Icon: Upload, label: 'Upload file' },
  gif_creator: { Icon: Camera, label: 'GIF recording' },
  shortcuts_list: { Icon: ListChecks, label: 'List shortcuts' },
  shortcuts_execute: { Icon: ListChecks, label: 'Run shortcut' },
};

const FALLBACK: ToolDisplay = { Icon: Terminal, label: 'Tool' };

const COMPUTER_ICON: Record<string, LucideIcon> = {
  screenshot: Camera,
  type: Type,
  key: Keyboard,
  zoom: Search,
};

/**
 * Official W() — stream row label + icon for a tool_use.
 * Pass `t` from useUi() for locale-correct copy.
 */
export function describeCall(
  name: string,
  input: unknown,
  t?: UiStrings,
): ToolDisplay {
  const args = (input ?? {}) as Record<string, unknown>;

  if (name === 'computer') return describeComputer(args, t);

  const base = TABLE[name] ?? FALLBACK;

  switch (name) {
    case 'read_page': {
      const f = args.filter;
      if (f === 'interactive') {
        return {
          ...base,
          label: t?.toolReadPageInteractive ?? 'Read page (interactive)',
        };
      }
      if (f === 'all') {
        return {
          ...base,
          label: t?.toolReadPageAll ?? 'Read page (all)',
        };
      }
      return { ...base, label: t?.toolReadPage ?? base.label };
    }
    case 'find': {
      const q = str(args.query);
      if (q) {
        const short = truncate(q, 30);
        return {
          ...base,
          label: t ? t.toolFindQuery(short) : `Find: “${short}”`,
        };
      }
      return { ...base, label: t?.toolFindElement ?? base.label };
    }
    case 'get_page_text':
      return { ...base, label: t?.toolExtractPageText ?? base.label };
    case 'navigate': {
      const url = str(args.url);
      if (url) {
        const short = truncate(url, 30);
        return {
          ...base,
          label: t ? t.toolNavigateTo(short) : `Navigate to ${short}`,
        };
      }
      return base;
    }
    case 'tabs_create':
      return { ...base, label: t?.toolCreateNewTab ?? 'Create new tab' };
    case 'tabs_context':
      return { ...base, label: t?.toolGetTabs ?? 'Get tabs' };
    case 'tabs_close':
      return { ...base, label: t?.toolCloseTab ?? 'Close tab' };
    case 'tabs_context_mcp':
      return { ...base, label: t?.toolGetMcpTabs ?? 'Get MCP tabs' };
    case 'tabs_create_mcp':
      return { ...base, label: t?.toolCreateMcpTab ?? 'Create MCP tab' };
    case 'tabs_close_mcp':
      return { ...base, label: t?.toolCloseMcpTab ?? 'Close MCP tab' };
    case 'resize_window':
      return { ...base, label: t?.toolResizeWindow ?? 'Resize window' };
    case 'form_input': {
      const value = args.value ?? args.text;
      if (value != null && String(value).length > 0) {
        const short = truncate(String(value), 20);
        // Official: Set input to “{value}” — keep EN shape; locale packs use toolSetFormValue alone.
        return {
          ...base,
          label: `${t?.toolSetFormValue ?? 'Set form value'}: “${short}”`,
        };
      }
      return { ...base, label: t?.toolSetFormValue ?? base.label };
    }
    case 'javascript_tool':
      return { ...base, label: t?.toolExecuteJavaScript ?? 'Execute JavaScript' };
    case 'read_console_messages':
      return str(args.level) && args.level !== 'all'
        ? { ...base, label: `Read console (${str(args.level)})` }
        : base;
    case 'browser_batch': {
      const n = Array.isArray(args.actions) ? args.actions.length : 0;
      if (n === 0) return base;
      return {
        ...base,
        label: t ? t.batchActions(0, n) : `Batch — 0/${n} actions`,
      };
    }
    case 'upload_image':
      return { ...base, label: t?.toolUploadImage ?? 'Upload image' };
    case 'file_upload': {
      const n =
        (Array.isArray(args.files) ? args.files.length : 0) +
        (Array.isArray(args.fileIds) ? args.fileIds.length : 0);
      if (n === 0) return base;
      return { ...base, label: `Upload ${n} file${n === 1 ? '' : 's'}` };
    }
    case 'gif_creator': {
      const a = str(args.action);
      if (!a) return base;
      if (a === 'start_recording') return { ...base, label: 'Start GIF recording' };
      if (a === 'stop_recording') return { ...base, label: 'Stop GIF recording' };
      if (a === 'export') return { ...base, label: 'Export GIF' };
      if (a === 'clear') return { ...base, label: 'Clear GIF frames' };
      return { ...base, label: `GIF: ${a}` };
    }
    case 'shortcuts_execute':
      return str(args.command)
        ? { ...base, label: `Run /${truncate(str(args.command)!, 24)}` }
        : base;
    case 'todowrite':
      return describeTodo(args, base, t);
    case 'update_plan':
      // Official gM owns Creating/Created/Rejected — not this TABLE label.
      return base;
    default:
      return base;
  }
}

/** Official TodoWrite: "Step {current} of {total}" / 第 N 步，共 M 步. */
function describeTodo(
  args: Record<string, unknown>,
  base: ToolDisplay,
  t?: UiStrings,
): ToolDisplay {
  const raw = args.todos ?? args.items;
  if (!Array.isArray(raw) || raw.length === 0) return base;
  let current = 1;
  for (let i = 0; i < raw.length; i++) {
    const item = raw[i] as { status?: string } | null;
    const s = item?.status;
    if (s === 'in_progress' || s === 'pending') {
      current = i + 1;
      break;
    }
  }
  return {
    ...base,
    label: t
      ? t.toolStepOf(current, raw.length)
      : `Step ${current} of ${raw.length}`,
  };
}

/**
 * Official computer action labels (W in KC):
 *   left_click → "Click" (no coordinate/ref in the stream label)
 *   type → Type: “…” / Type text
 */
function describeComputer(
  args: Record<string, unknown>,
  t?: UiStrings,
): ToolDisplay {
  const action = str(args.action) ?? '';
  const Icon = COMPUTER_ICON[action] ?? MousePointerClick;

  const label = ((): string => {
    switch (action) {
      case 'screenshot':
        return t?.toolTakeScreenshot ?? 'Take screenshot';
      case 'left_click':
        // Official W: plain "Click" — no target suffix on computer left_click.
        return t?.toolClick ?? 'Click';
      case 'right_click':
        return t?.toolRightClick ?? 'Right-click';
      case 'middle_click':
        return 'Middle-click';
      case 'double_click':
        return t?.toolDoubleClick ?? 'Double-click';
      case 'triple_click':
        return t?.toolTripleClick ?? 'Triple-click';
      case 'left_click_drag':
        return t?.toolDrag ?? 'Drag';
      case 'type': {
        const text = str(args.text);
        if (text) {
          const short = truncate(text, 30);
          return t ? t.toolTypeWith(short) : `Type: “${short}”`;
        }
        return t?.toolTypeText ?? 'Type text';
      }
      case 'key': {
        const key = str(args.text) ?? str(args.key);
        if (key) {
          return t ? t.toolPressKeyWith(truncate(key, 30)) : `Press key: ${key}`;
        }
        return t?.toolPressKey ?? 'Press key';
      }
      case 'scroll': {
        const dir = str(args.scroll_direction);
        if (dir) return t ? t.toolScrollDir(dir) : `Scroll ${dir}`;
        return t?.toolScroll ?? 'Scroll';
      }
      case 'scroll_to':
        return target(args) ? `Scroll to: ${target(args)}` : 'Scroll to element';
      case 'wait': {
        const d = typeof args.duration === 'number' ? args.duration : undefined;
        if (d === undefined) return 'Wait';
        return t ? t.toolWaitSeconds(d) : `Wait ${d} second${d === 1 ? '' : 's'}`;
      }
      case 'zoom':
        return 'Zoom in';
      default:
        return `Computer action: ${action || 'Unknown'}`;
    }
  })();

  return { Icon, label };
}

function target(args: Record<string, unknown>): string | undefined {
  const ref = str(args.ref);
  if (ref) return ref;
  const c = args.coordinate;
  if (
    Array.isArray(c) &&
    c.length === 2 &&
    typeof c[0] === 'number' &&
    typeof c[1] === 'number'
  ) {
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
