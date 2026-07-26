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

  // ── 头部 ──
  //
  // 「清空对话」在原版里不是垃圾桶，是**带加号的对话气泡**（语义 = 开新对话）。
  MessageCirclePlus as NewChatIcon,
  Settings as SettingsIcon,

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
  ListChecks,
  MousePointerClick,
  MoveHorizontal,
  Network,
  Search,
  SquareDashed,
  Terminal,
  Type,
  X,
} from 'lucide-react';
