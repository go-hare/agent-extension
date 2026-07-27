/**
 * 图标层 —— 全项目**唯一**的图标来源。
 *
 * 这个文件之前手抄过一批原版的 20×20 path 几何数据，现在全部删掉了，两个理由：
 *
 *  1. 原版那套 20×20 字形是 Anthropic 自家的图标集（bundle 里还配了一个
 *     `anthropicons-variable-*.woff2` 字体），属于人家的美术资产。
 *  2. 更实际的问题：手抄 `d` 串是**不可验证**的。少一个小数点、写错一个
 *     圆弧的 large-arc-flag，图标就歪成一团，而 code review 里根本看不出来。
 *     lucide-react 是版本锁死的依赖（0.545.0，与原版 package 一致），
 *     几何数据的正确性由上游保证。
 *
 * 所以这里只做一件事：**把 lucide 的美术名重命名成本项目语义上的名字**。
 * 组件其余部分（className 串、尺寸、hover 态）仍然逐字照原版。
 *
 * 为什么要这层别名，而不是各组件直接 `import { ArrowUp } from 'lucide-react'`：
 *  - 语义名（`SendIcon`）比美术名（`ArrowUp`）更能说明它在 UI 里干什么，
 *    也避免下一个人看到 `ArrowUp` 以为是滚动按钮；
 *  - 将来换图标集只改这一个文件。
 */

import type { SVGProps } from 'react';
import type { LucideProps } from 'lucide-react';

export type { LucideIcon } from 'lucide-react';

export {
  // ── 折叠 / 层级 ──
  ChevronDown as CaretDown,
  ChevronUp as CaretUp,
  ChevronRight as CaretRight,
  EllipsisVertical as MenuIcon,

  // ── 输入框按钮 ──
  //
  // 原版发送键是一个**向上箭头**（Phosphor ArrowUp，bold weight），不是纸飞机；
  // 停止键是**圆里套方块**。lucide 的 ArrowUp / CircleStop 对应同一语义。
  ArrowUp as SendIcon,
  CircleStop as StopIcon,
  X as CloseIcon,
  // 官方 composer 1.0.81：Teach = 鼠标点击光标（sidepanel b / click），
  // Actions 触发器 = Plus（Qa size 12）；菜单内 Camera / Image
  MousePointerClick as TeachIcon,
  Plus as AttachIcon,
  Image as ImageIcon,

  // ── 头部 ──
  //
  // 「清空对话」在原版里不是垃圾桶，是**带加号的对话气泡**（语义 = 开新对话）。
  // 官方 FZ 菜单：Convert to task = Clock(ua)、Settings = zs、Language = Globe（工具区已 re-export）。
  MessageCirclePlus as NewChatIcon,
  Settings as SettingsIcon,
  Clock,

  // ── 状态 ──
  Check as CheckIcon,
  LoaderCircle as SpinnerIcon,
  CircleAlert as AlertIcon,
  ShieldCheck as ShieldIcon,
  TriangleAlert as WarningIcon,

  // ── 工具行（toolDisplay.describeCall 用） ──
  Camera,
  Code,
  ExternalLink,
  FileText,
  Globe,
  Keyboard,
  Layers,
  ListChecks,
  MousePointerClick,
  MoveHorizontal,
  Network,
  Paperclip,
  Search,
  SquareDashed,
  Terminal,
  Type,
  Upload,
  X,
} from 'lucide-react';

/**
 * Permission-mode icons — path geometry taken from Claude in Chrome 1.0.81
 * (sidepanel-CEYFzMrx.js: ks = raised hand, xz = skip-forward double triangle).
 *
 * Lucide Hand / FastForward look different enough that the composer row
 * no longer matches the official chrome; these keep the same size/className API.
 */

type IconProps = LucideProps;

function OfficialSvg({
  size = 16,
  className,
  color = 'currentColor',
  strokeWidth: _sw,
  absoluteStrokeWidth: _asw,
  ...rest
}: IconProps) {
  const s = typeof size === 'number' ? size : Number(size) || 16;
  return {
    width: s,
    height: s,
    viewBox: '0 0 20 20' as const,
    fill: color,
    xmlns: 'http://www.w3.org/2000/svg',
    className,
    'aria-hidden': true as const,
    ...rest,
  } satisfies SVGProps<SVGSVGElement>;
}

/** Official "Ask before acting" — raised hand (ks, size 12 in composer). */
export function AskModeIcon(props: IconProps) {
  return (
    <svg {...OfficialSvg(props)}>
      <path d="M10.25 2a1.75 1.75 0 0 1 1.664 1.21A1.75 1.75 0 0 1 14.5 4.75v1.42A1.75 1.75 0 0 1 17 7.75v3.5a6.75 6.75 0 0 1-13.5 0V8a1 1 0 0 1 1-1H5c.365 0 .706.1 1 .27V4.75a1.75 1.75 0 0 1 2.585-1.54A1.75 1.75 0 0 1 10.25 2m0 1a.75.75 0 0 0-.75.75V9.5a.5.5 0 0 1-1 0V4.75a.75.75 0 0 0-1.5 0v6.252a3.14 3.14 0 0 1 2.91 2.12l.075.257.015.1a.501.501 0 0 1-.951.238l-.034-.096-.052-.175A2.14 2.14 0 0 0 6.938 12H6.5a.5.5 0 0 1-.5-.5V9a1 1 0 0 0-1-1h-.5v3.25a5.75 5.75 0 0 0 11.5 0v-3.5a.75.75 0 0 0-1.5 0v2.75a.5.5 0 0 1-1 0V4.75a.75.75 0 0 0-1.5 0V9.5a.5.5 0 0 1-1 0V3.75a.75.75 0 0 0-.75-.75" />
    </svg>
  );
}

/** Official "Act without asking" — skip-forward double triangle (xz, size 16). */
export function SkipModeIcon(props: IconProps) {
  return (
    <svg {...OfficialSvg(props)}>
      <g transform="translate(2, 2)">
        <path d="M14.9744 7.27177L9.46313 3.76115C9.33107 3.67737 9.17898 3.63051 9.02267 3.62546C8.86637 3.6204 8.71157 3.65733 8.57438 3.7324C8.43845 3.80679 8.32503 3.91635 8.24597 4.04962C8.16691 4.18288 8.12513 4.33495 8.125 4.48989V7.05239L2.96312 3.76115C2.83107 3.67737 2.67898 3.63051 2.52267 3.62546C2.36637 3.6204 2.21157 3.65733 2.07437 3.7324C1.93845 3.80679 1.82503 3.91635 1.74597 4.04962C1.66691 4.18288 1.62513 4.33495 1.625 4.48989V11.5099C1.62513 11.6648 1.66691 11.8169 1.74597 11.9502C1.82503 12.0834 1.93845 12.193 2.07437 12.2674C2.21157 12.3425 2.36637 12.3794 2.52267 12.3743C2.67898 12.3693 2.83107 12.3224 2.96312 12.2386L8.125 8.95052V11.5099C8.12513 11.6648 8.16691 11.8169 8.24597 11.9502C8.32503 12.0834 8.43845 12.193 8.57438 12.2674C8.71157 12.3425 8.86637 12.3794 9.02267 12.3743C9.17898 12.3693 9.33107 12.3224 9.46313 12.2386L14.9744 8.72802C15.0971 8.65027 15.1982 8.54275 15.2683 8.41545C15.3384 8.28815 15.3751 8.1452 15.3751 7.9999C15.3751 7.85459 15.3384 7.71164 15.2683 7.58434C15.1982 7.45704 15.0971 7.34952 14.9744 7.27177ZM8.07187 8.09552L2.5625 11.6055C2.54408 11.6177 2.52262 11.6245 2.50053 11.6252C2.47845 11.6258 2.45662 11.6203 2.4375 11.6093C2.41862 11.6005 2.40268 11.5864 2.39159 11.5688C2.3805 11.5512 2.37474 11.5307 2.375 11.5099V4.48989C2.37474 4.46907 2.3805 4.44862 2.39159 4.43099C2.40268 4.41336 2.41862 4.39931 2.4375 4.39052C2.45655 4.37972 2.4781 4.37412 2.5 4.37427C2.52232 4.37483 2.544 4.38177 2.5625 4.39427L8.07438 7.90427C8.09065 7.91436 8.10409 7.92844 8.11341 7.94517C8.12272 7.96191 8.12761 7.98074 8.12761 7.9999C8.12761 8.01905 8.12272 8.03788 8.11341 8.05462C8.10409 8.07135 8.09065 8.08543 8.07438 8.09552H8.07187ZM14.5719 8.09552L9.0625 11.6055C9.04408 11.6177 9.02262 11.6245 9.00053 11.6252C8.97845 11.6258 8.95662 11.6203 8.9375 11.6093C8.91862 11.6005 8.90268 11.5864 8.89159 11.5688C8.8805 11.5512 8.87474 11.5307 8.875 11.5099V4.48989C8.87474 4.46907 8.8805 4.44862 8.89159 4.43099C8.90268 4.41336 8.91862 4.39931 8.9375 4.39052C8.95655 4.37972 8.9781 4.37412 9 4.37427C9.02232 4.37483 9.044 4.38177 9.0625 4.39427L14.5744 7.90427C14.5907 7.91436 14.6041 7.92844 14.6134 7.94517C14.6227 7.96191 14.6276 7.98074 14.6276 7.9999C14.6276 8.01905 14.6227 8.03788 14.6134 8.05462C14.6041 8.07135 14.5907 8.08543 14.5744 8.09552H14.5719Z" />
      </g>
    </svg>
  );
}

/**
 * Official Claude starburst mark (`ci` in sidepanel-CEYFzMrx.js).
 * StatusPill / Working indicator uses this with `text-brand-200` / fill-current —
 * NOT a plain orange circle.
 *
 * viewBox is 0 0 100 100 (official static spark fallback when sprite sheet not loaded).
 */
export function ClaudeSparkIcon({
  size = 20,
  className,
  color = 'currentColor',
  ...rest
}: IconProps) {
  const s = typeof size === 'number' ? size : Number(size) || 20;
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 100 100"
      width={s}
      height={s}
      fill={color}
      className={className}
      aria-hidden
      {...rest}
    >
      <path d="m19.6 66.5 19.7-11 .3-1-.3-.5h-1l-3.3-.2-11.2-.3L14 53l-9.5-.5-2.4-.5L0 49l.2-1.5 2-1.3 2.9.2 6.3.5 9.5.6 6.9.4L38 49.1h1.6l.2-.7-.5-.4-.4-.4L29 41l-10.6-7-5.6-4.1-3-2-1.5-2-.6-4.2 2.7-3 3.7.3.9.2 3.7 2.9 8 6.1L37 36l1.5 1.2.6-.4.1-.3-.7-1.1L33 25l-6-10.4-2.7-4.3-.7-2.6c-.3-1-.4-2-.4-3l3-4.2L28 0l4.2.6L33.8 2l2.6 6 4.1 9.3L47 29.9l2 3.8 1 3.4.3 1h.7v-.5l.5-7.2 1-8.7 1-11.2.3-3.2 1.6-3.8 3-2L61 2.6l2 2.9-.3 1.8-1.1 7.7L59 27.1l-1.5 8.2h.9l1-1.1 4.1-5.4 6.9-8.6 3-3.5L77 13l2.3-1.8h4.3l3.1 4.7-1.4 4.9-4.4 5.6-3.7 4.7-5.3 7.1-3.2 5.7.3.4h.7l12-2.6 6.4-1.1 7.6-1.3 3.5 1.6.4 1.6-1.4 3.4-8.2 2-9.6 2-14.3 3.3-.2.1.2.3 6.4.6 2.8.2h6.8l12.6 1 3.3 2 1.9 2.7-.3 2-5.1 2.6-6.8-1.6-16-3.8-5.4-1.3h-.8v.4l4.6 4.5 8.3 7.5L89 80.1l.5 2.4-1.3 2-1.4-.2-9.2-7-3.6-3-8-6.8h-.5v.7l1.8 2.7 9.8 14.7.5 4.5-.7 1.4-2.6 1-2.7-.6-5.8-8-6-9-4.7-8.2-.5.4-2.9 30.2-1.3 1.5-3 1.2-2.5-2-1.4-3 1.4-6.2 1.6-8 1.3-6.4 1.2-7.9.7-2.6v-.2H49L43 72l-9 12.3-7.2 7.6-1.7.7-3-1.5.3-2.8L24 86l10-12.8 6-7.9 4-4.6-.1-.5h-.3L17.2 77.4l-4.7.6-2-2 .2-3 1-1 8-5.5Z" />
    </svg>
  );
}
