/**
 * 全局共享类型。跨 background / sidepanel / content script 三个上下文使用，
 * 所以这里只放纯类型和常量，不要 import 任何有副作用的模块。
 */

// ───────────────────────────── 权限 ─────────────────────────────

/**
 * 权限枚举。对齐原版 Claude in Chrome 的动作粒度：
 * 权限是按 **动作类别** 分的，不是按工具分的 —— 因为 `computer` 一个工具
 * 里既有只读的 screenshot 又有会改变页面状态的 left_click。
 */
export const PERMISSION = {
  READ_PAGE_CONTENT: 'read_page_content',
  CLICK: 'click',
  TYPE: 'type',
  NAVIGATE: 'navigate',
  EXECUTE_JAVASCRIPT: 'execute_javascript',
  UPLOAD_IMAGE: 'upload_image',
  READ_CONSOLE_MESSAGES: 'read_console_messages',
  READ_NETWORK_REQUESTS: 'read_network_requests',
  PLAN_APPROVAL: 'plan_approval',
} as const;

export type Permission = (typeof PERMISSION)[keyof typeof PERMISSION];

/** 权限判定结果。needsPrompt 为 true 时必须在**聊天界面**弹授权，不能在页面里问。 */
export interface PermissionDecision {
  allowed: boolean;
  needsPrompt: boolean;
  /** 为什么被拒 / 为什么要问，用于回灌给模型的 tool_result 文案 */
  reason?: string;
}

export interface PermissionRequest {
  type: 'permission_required';
  toolUseId: string;
  tool: string;
  permission: Permission;
  url: string;
  host: string;
  /** 人类可读的动作描述，如 'Click "Submit order"' */
  actionLabel: string;
  /** 点击类动作附带的截图预览（data URL），让用户看清将要点哪里 */
  screenshot?: string;
  /** 原始工具入参，供 UI 展示细节 */
  actionData?: unknown;
}

export type PermissionScope = 'once' | 'turn' | 'domain' | 'always';

export interface PermissionResponse {
  toolUseId: string;
  granted: boolean;
  scope: PermissionScope;
}

// ───────────────────────────── 工具 ─────────────────────────────

/** 工具执行上下文。由 agent loop 注入，工具实现不自己去查当前 tab。 */
export interface ToolContext {
  /** 侧栏当前锚定的 tab */
  tabId: number;
  windowId: number;
  /** 本轮对话 id，用于 turn 级权限重置 */
  turnId: string;
  /** 该次 tool_use 的 id，权限提示要带上它才能对上号 */
  toolUseId: string;
  signal: AbortSignal;
  /**
   * 在 browser_batch 内为 true：需要用户点授权时直接失败，
   * 不挂起等 UI（对齐官方 batch 语义）。
   */
  batchMode?: boolean;
  /**
   * Open-MCP / native-messaging runs: skip the chat-only follow_a_plan gate.
   * Official MCP uses a separate permissionManager without plan-first.
   */
  skipPlanGate?: boolean;
  /**
   * Official MCP: when requestPermission needs a prompt, tools return
   * `permissionRequired` instead of waiting; bridge prompts + grantOnce + retries.
   */
  mcpPermissionRequired?: boolean;
  /** 当前对话 messages，供 upload_image 按 imageId 回扫历史图片。 */
  messages?: unknown[];
  /** 请求权限。工具内部调用，被拒时应返回 error 而不是抛异常。 */
  requestPermission(
    permission: Permission,
    detail: { actionLabel: string; url?: string; screenshot?: string; actionData?: unknown },
  ): Promise<PermissionDecision>;
}

export interface TabContext {
  currentTabId: number;
  executedOnTabId?: number;
  availableTabs: TabInfo[];
  tabCount: number;
  /** Chrome tab group id when the session is group-scoped */
  tabGroupId?: number;
  tabGroupTitle?: string;
}

/** 工具返回。要么有 output（文本），要么有 error；图片走 images。 */
export interface ToolResult {
  output?: string;
  error?: string;
  /** base64 图片，会被转成 Anthropic 的 image content block */
  images?: Array<{ mediaType: 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif'; data: string }>;
  /** 附加的 tab 上下文，让模型知道现在有哪些 tab 可用 */
  tabContext?: TabContext;
  /**
   * Official MCP shape: tool returned permission_required instead of executing.
   * Bridge prompts, grantOnce, then retries handleToolCall once.
   */
  permissionRequired?: {
    permission: Permission;
    url: string;
    actionLabel: string;
    screenshot?: string;
    actionData?: unknown;
  };
}

export interface TabInfo {
  tabId: number;
  url: string;
  title: string;
  active: boolean;
  windowId: number;
  groupId?: number;
  /** 是否可被 debugger attach（chrome:// 等不行） */
  attachable: boolean;
}

// ───────────────────────────── 消息协议 ─────────────────────────────

/**
 * 侧栏 → SW。
 *
 * 设计上照搬原版的一个关键决定：**工具在侧栏上下文里执行，不经过 SW 转发**。
 * 侧栏直接 import 工具层，chrome.debugger / chrome.tabs 在扩展页面里都能用。
 * 所以这里没有 EXECUTE_TOOL 消息 —— SW 只管全局状态、DNR、alarms、offscreen。
 */
export type PanelToBackground =
  | { type: 'PANEL_OPENED'; tabId: number; windowId: number }
  | { type: 'PANEL_CLOSED'; tabId: number }
  | { type: 'GET_SETTINGS' }
  | { type: 'SAVE_SETTINGS'; settings: Partial<Settings> }
  | { type: 'OPEN_OPTIONS' }
  | { type: 'PLAY_NOTIFICATION_SOUND' }
  | { type: 'SHOW_PERMISSION_NOTIFICATION'; title: string; message: string }
  | { type: 'PERMISSION_RESPONSE'; response: PermissionResponse }
  | { type: 'RESIZE_WINDOW'; windowId: number; width: number; height: number };

/** content script → SW / 侧栏 */
export type ContentToExtension =
  | { type: 'A11Y_TREE_RESULT'; requestId: string; result: AccessibilityTreeResult }
  | { type: 'ELEMENT_SELECTION'; ref: string; label: string }
  | { type: 'CANCEL_ELEMENT_OVERLAY' };

/** SW / 侧栏 → content script */
export type ExtensionToContent =
  | {
      type: 'GENERATE_A11Y_TREE';
      requestId: string;
      options: A11yTreeOptions;
    }
  | { type: 'SHOW_AGENT_INDICATOR'; label: string }
  | { type: 'HIDE_AGENT_INDICATOR' }
  | { type: 'START_ELEMENT_PICKER' };

// ───────────────────────── a11y 树 ─────────────────────────

export interface A11yTreeOptions {
  /** all = 全部节点；interactive = 只要可交互的 */
  filter: 'all' | 'interactive';
  /** 最大深度，默认 15 */
  maxDepth?: number;
  /** 输出字符上限，默认 50000 */
  maxChars?: number;
  /** 只看某个元素的子树 */
  refId?: string | null;
}

export interface AccessibilityTreeResult {
  pageContent: string;
  viewport: { width: number; height: number };
  error?: string;
}

// ───────────────────────────── 设置 ─────────────────────────────

export interface Settings {
  /** API 中转站 base，如 https://relay.example.com（不含 /v1） */
  apiBaseUrl: string;
  apiKey: string;
  model: string;
  /** 可用模型列表，从 {base}/v1/models 拉 */
  availableModels: string[];
  maxTokens: number;
  /** 主题 */
  theme: 'claude';
  mode: 'light' | 'dark' | 'system';
  /**
   * UI + model-reply language. Matches official Chrome packs we ship
   * under src/i18n/locales (14 locales).
   */
  locale:
    | 'en-US'
    | 'zh-CN'
    | 'zh-TW'
    | 'ja-JP'
    | 'ko-KR'
    | 'de-DE'
    | 'fr-FR'
    | 'es-ES'
    | 'es-419'
    | 'pt-BR'
    | 'it-IT'
    | 'ru-RU'
    | 'hi-IN'
    | 'id-ID';
  /**
   * 权限模式（对齐原版 composer 左下角切换）：
   *  - `ask`  = "Ask before acting" —— 常规权限弹气泡
   *  - `skip` = "Act without asking" —— 普通动作自动放行
   *
   * 即使用 skip，不可逆动作 / 敏感站点 / plan_approval / execute_javascript
   * 仍然强制询问。`forcePrompt` 为 true 时覆盖 skip，回到每次都问。
   */
  permissionMode: 'ask' | 'skip';
  /** 每次动作都要问，即使之前授权过 / 即使开了 skip */
  forcePrompt: boolean;
  /** 只在这些域名上工作（空 = 不限制） */
  allowedDomains: string[];
  deniedDomains: string[];
  /** 允许模型跑任意 JS —— 危险，默认关 */
  enableJavascriptTool: boolean;
  /** 允许批量工具调用 */
  enableBrowserBatch: boolean;
  /** 通知音 */
  soundEnabled: boolean;
  /**
   * 侧栏是否折叠工具步骤行。
   * 默认折叠成一行摘要（Hide steps），展开后显示每次 tool_use。
   */
  hideToolSteps: boolean;
  /** Teach Claude：录制时默认开启语音转写（可随时在录制条上开关）。 */
  teachSpeechEnabled: boolean;
  /** Teach Claude：SpeechRecognition 的 BCP-47 语言；空串 = 跟随 UI locale。 */
  teachSpeechLang: string;
  /** Teach Claude：录制时捕获页面截图帧，便于结束后导出 GIF。 */
  teachCaptureFrames: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  apiBaseUrl: '',
  apiKey: '',
  model: '',
  availableModels: [],
  maxTokens: 8192,
  theme: 'claude',
  mode: 'system',
  locale: 'en-US',
  permissionMode: 'ask',
  forcePrompt: false,
  allowedDomains: [],
  deniedDomains: [],
  enableJavascriptTool: false,
  enableBrowserBatch: true,
  soundEnabled: true,
  hideToolSteps: false,
  teachSpeechEnabled: false,
  teachSpeechLang: '',
  teachCaptureFrames: true,
};

// ───────────────────────────── 会话 ─────────────────────────────

export interface StoredConversation {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  /** Anthropic MessageParam[]，存原样以便直接回灌 */
  messages: unknown[];
}
