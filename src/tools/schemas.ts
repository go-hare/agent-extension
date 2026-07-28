/**
 * 工具入参的 zod schema + 发给模型的 JSON Schema。
 *
 * 为什么两套：
 *  - 发给模型的是 JSON Schema（Anthropic API 要求），它只是**建议**，
 *    模型完全可能给出不符合的入参（少字段、类型错、枚举外的值）。
 *  - 所以执行前必须再用 zod 校验一遍。校验失败要返回**给模型能看懂的错误**，
 *    而不是抛异常 —— 模型看到 "coordinate: expected array, got string" 会自己改，
 *    看到 stack trace 就只会重试同样的错误。
 *
 * 描述文案的措辞很讲究，都是在告诉模型"什么时候用"和"出错了怎么办"。
 * 写得含糊模型就会乱用工具，写得太长又浪费每一轮的 token。
 */

import { z } from 'zod';

/** Anthropic tool 定义的形状（自定义工具，非 server tool）。 */
export interface AnthropicToolSchema {
  name: string;
  description: string;
  input_schema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

// 所有会作用于页面的工具都接受 tabId —— 模型可能同时管着好几个 tab。
const tabIdProp = {
  type: 'number',
  description:
    "Tab ID to act on. Must be a tab the extension is attached to. Use tabs_context first if you don't have a valid tab ID.",
};

// ───────────────────────────── computer ─────────────────────────────

export const COMPUTER_ACTIONS = [
  'left_click',
  'right_click',
  'type',
  'screenshot',
  'wait',
  'scroll',
  'key',
  'left_click_drag',
  'double_click',
  'triple_click',
  'zoom',
  'scroll_to',
  'hover',
] as const;

export type ComputerAction = (typeof COMPUTER_ACTIONS)[number];

const coordinate = z.tuple([z.number(), z.number()]);

/**
 * computer 的 zod schema。
 *
 * 用 superRefine 而不是 discriminatedUnion，因为模型经常在正确的 action 上
 * 多带几个无关字段（比如给 screenshot 也带 coordinate）。用 union 会直接报
 * "no matching variant"，模型完全看不出问题在哪。逐条 refine 能给出
 * "action=scroll requires scroll_direction" 这种可操作的错误。
 */
export const computerInput = z
  .object({
    action: z.enum(COMPUTER_ACTIONS),
    coordinate: coordinate.optional(),
    text: z.string().optional(),
    duration: z.number().min(0).max(10).optional(),
    scroll_direction: z.enum(['up', 'down', 'left', 'right']).optional(),
    scroll_amount: z.number().min(1).max(10).optional(),
    start_coordinate: coordinate.optional(),
    region: z.tuple([z.number(), z.number(), z.number(), z.number()]).optional(),
    repeat: z.number().int().min(1).max(100).optional(),
    ref: z.string().optional(),
    modifiers: z.string().optional(),
    tabId: z.number().optional(),
  })
  .superRefine((v, ctx) => {
    const needsTarget = (
      ['left_click', 'right_click', 'double_click', 'triple_click', 'hover'] as string[]
    ).includes(v.action);

    if (needsTarget && !v.coordinate && !v.ref) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['coordinate'],
        message: `action "${v.action}" needs either coordinate [x, y] or ref (from read_page/find). Take a screenshot or call read_page first.`,
      });
    }
    if (needsTarget && v.coordinate && v.ref) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['ref'],
        message: 'Provide coordinate or ref, not both.',
      });
    }
    if ((v.action === 'type' || v.action === 'key') && !v.text) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['text'],
        message: `action "${v.action}" requires text.`,
      });
    }
    if (v.action === 'scroll' && !v.scroll_direction) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['scroll_direction'],
        message: 'action "scroll" requires scroll_direction (up/down/left/right).',
      });
    }
    if (v.action === 'scroll' && !v.coordinate) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['coordinate'],
        message: 'action "scroll" requires coordinate [x, y] (scroll origin in screenshot space).',
      });
    }
    if (v.action === 'left_click_drag' && (!v.start_coordinate || !v.coordinate)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['start_coordinate'],
        message: 'action "left_click_drag" requires both start_coordinate and coordinate.',
      });
    }
    if (v.action === 'zoom' && !v.region) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['region'],
        message: 'action "zoom" requires region [x0, y0, x1, y1].',
      });
    }
    if (v.action === 'scroll_to' && !v.ref) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['ref'],
        message: 'action "scroll_to" requires ref (from read_page/find).',
      });
    }
    if (v.action === 'wait' && v.duration === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['duration'],
        message: 'action "wait" requires duration in seconds (max 10).',
      });
    }
  });

export type ComputerInput = z.infer<typeof computerInput>;

export const computerSchema: AnthropicToolSchema = {
  name: 'computer',
  description:
    'Use a mouse and keyboard to interact with a web browser, and take screenshots. ' +
    "If you don't have a valid tab ID, use tabs_context first to get available tabs.\n" +
    '* Whenever you intend to click on an element like an icon, you should consult a screenshot ' +
    'to determine the coordinates of the element before moving the cursor.\n' +
    '* If you tried clicking on a program or link but it failed to load, even after waiting, ' +
    'try adjusting your click location so that the tip of the cursor visually falls on the element you want.\n' +
    '* Make sure to click any buttons, links, icons, etc with the cursor tip in the center of the element. ' +
    "Don't click boxes on their edges unless asked.\n" +
    '* Prefer `ref` over `coordinate` when you already called read_page or find — refs survive small ' +
    'layout shifts, raw coordinates do not.',
  input_schema: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: COMPUTER_ACTIONS,
        description:
          'The action to perform:\n' +
          '* `left_click`: Click the left mouse button at the specified coordinates.\n' +
          '* `right_click`: Click the right mouse button at the specified coordinates to open context menus.\n' +
          '* `double_click`: Double-click the left mouse button at the specified coordinates.\n' +
          '* `triple_click`: Triple-click the left mouse button at the specified coordinates (selects a line).\n' +
          '* `type`: Type a string of text into the focused element.\n' +
          '* `screenshot`: Take a screenshot of the visible viewport.\n' +
          '* `wait`: Wait for a specified number of seconds.\n' +
          '* `scroll`: Scroll up, down, left, or right at the specified coordinates.\n' +
          '* `key`: Press a specific keyboard key or shortcut.\n' +
          '* `left_click_drag`: Drag from start_coordinate to coordinate.\n' +
          '* `zoom`: Take a screenshot of a specific region and scale it to fill the viewport.\n' +
          '* `scroll_to`: Scroll an element into view using its element reference ID from read_page or find.\n' +
          '* `hover`: Move the cursor to the coordinates or element without clicking. Reveals tooltips and dropdown menus.',
      },
      coordinate: {
        type: 'array',
        items: { type: 'number' },
        minItems: 2,
        maxItems: 2,
        description:
          '(x, y): The x (pixels from the left edge) and y (pixels from the top edge) coordinates. ' +
          'Required for `scroll` and `left_click_drag`. For click actions (left_click, right_click, ' +
          'double_click, triple_click) and `hover`, either `coordinate` or `ref` must be provided (not both).',
      },
      text: {
        type: 'string',
        description:
          'The text to type (for `type`) or the key(s) to press (for `key`). For `key`: provide ' +
          'space-separated keys (e.g. "Backspace Backspace Delete"). Supports shortcuts using the ' +
          'platform modifier (use "cmd" on Mac, "ctrl" on Windows/Linux, e.g. "cmd+a"). ' +
          'Page zoom shortcuts (e.g. "cmd+=", "ctrl+-", "cmd+0") are not supported and will return ' +
          'an error — use the `zoom` action to magnify a region of the page instead.',
      },
      duration: {
        type: 'number',
        minimum: 0,
        maximum: 10,
        description: 'The number of seconds to wait. Required for `wait`. Maximum 10 seconds.',
      },
      scroll_direction: {
        type: 'string',
        enum: ['up', 'down', 'left', 'right'],
        description: 'The direction to scroll. Required for `scroll`.',
      },
      scroll_amount: {
        type: 'number',
        minimum: 1,
        maximum: 10,
        description: 'The number of scroll wheel ticks. Optional for `scroll`, defaults to 3.',
      },
      start_coordinate: {
        type: 'array',
        items: { type: 'number' },
        minItems: 2,
        maxItems: 2,
        description: '(x, y): The starting coordinates for `left_click_drag`.',
      },
      region: {
        type: 'array',
        items: { type: 'number' },
        minItems: 4,
        maxItems: 4,
        description:
          '(x0, y0, x1, y1): The rectangular region to capture for `zoom`. Coordinates are in ' +
          'pixels from the top-left corner of the viewport. Required for `zoom`.',
      },
      repeat: {
        type: 'number',
        minimum: 1,
        maximum: 100,
        description:
          'Number of times to repeat the key sequence. Only applicable for `key`. ' +
          'Must be a positive integer between 1 and 100. Default is 1.',
      },
      ref: {
        type: 'string',
        description:
          'Element reference ID from read_page or find (e.g. "ref_1", "ref_2"). Required for ' +
          '`scroll_to`. Can be used instead of `coordinate` for click and hover actions.',
      },
      modifiers: {
        type: 'string',
        description:
          'Modifier keys held during click actions. Supports "ctrl", "shift", "alt", "cmd" ' +
          '(or "meta"). Combine with "+" (e.g. "ctrl+shift"). Optional.',
      },
      tabId: tabIdProp,
    },
    required: ['action'],
  },
};

// ───────────────────────────── read_page ─────────────────────────────

export const readPageInput = z.object({
  filter: z.enum(['interactive', 'all']).optional(),
  tabId: z.number().optional(),
  depth: z.number().int().min(1).max(50).optional(),
  ref_id: z.string().optional(),
  max_chars: z.number().int().min(500).max(200_000).optional(),
});

export const readPageSchema: AnthropicToolSchema = {
  name: 'read_page',
  description:
    'Get an accessibility tree representation of elements on the page. By default returns all ' +
    'elements including non-visible ones. Can optionally filter for only interactive elements, ' +
    'limit tree depth, or focus on a specific element. Returns a structured tree that represents ' +
    'how screen readers see the page content, with [ref_N] handles you can pass to computer ' +
    "(click/hover/scroll_to) and form_input. If you don't have a valid tab ID, use tabs_context " +
    'first. Output is limited to 50000 characters — if exceeded, the tree is truncated at a line ' +
    'boundary with a note giving the full size; pass a larger max_chars, or use depth/ref_id to focus.',
  input_schema: {
    type: 'object',
    properties: {
      filter: {
        type: 'string',
        enum: ['interactive', 'all'],
        description:
          'Filter elements: "interactive" for buttons/links/inputs only, "all" for all elements ' +
          'including non-visible ones (default: all).',
      },
      tabId: tabIdProp,
      depth: {
        type: 'number',
        description: 'Maximum depth of the tree to traverse (default: 15). Use a smaller depth if output is too large.',
      },
      ref_id: {
        type: 'string',
        description:
          'Reference ID of a parent element to read. Returns the specified element and all its ' +
          'children. Use this to focus on part of the page when output is too large.',
      },
      max_chars: {
        type: 'number',
        description: 'Maximum characters for output (default: 50000).',
      },
    },
  },
};

// ───────────────────────────── find ─────────────────────────────

export const findInput = z.object({
  query: z.string().min(1),
  tabId: z.number().optional(),
});

export const findSchema: AnthropicToolSchema = {
  name: 'find',
  description:
    'Find elements on the page using natural language. Can search for elements by their purpose ' +
    '(e.g. "search bar", "login button") or by text content (e.g. "organic mango product"). ' +
    'Returns up to 20 matching elements with [ref_N] references usable with other tools. ' +
    "If more than 20 matches exist, you'll be told to use a more specific query. " +
    'Prefer this over read_page when you know what you are looking for — it is much cheaper.',
  input_schema: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description:
          'Natural language description of what to find (e.g. "search bar", "add to cart button", ' +
          '"product title containing organic").',
      },
      tabId: tabIdProp,
    },
    required: ['query'],
  },
};

// ───────────────────────────── get_page_text ─────────────────────────────

export const getPageTextInput = z.object({
  tabId: z.number().optional(),
  max_chars: z.number().int().min(500).max(200_000).optional(),
});

export const getPageTextSchema: AnthropicToolSchema = {
  name: 'get_page_text',
  description:
    'Extract raw text content from the page, prioritizing article content. Ideal for reading ' +
    'articles, blog posts, or other text-heavy pages. Returns plain text without HTML formatting ' +
    'and without [ref_N] handles — use read_page or find if you need to interact with elements. ' +
    'Output is limited to 50000 characters by default; if it exceeds the limit it is truncated ' +
    'with a note giving the full size.',
  input_schema: {
    type: 'object',
    properties: {
      tabId: tabIdProp,
      max_chars: {
        type: 'number',
        description: 'Maximum characters for output (default: 50000).',
      },
    },
  },
};

// ───────────────────────────── form_input ─────────────────────────────

export const formInputInput = z.object({
  ref: z.string().min(1),
  value: z.union([z.string(), z.boolean(), z.number()]),
  tabId: z.number().optional(),
});

export const formInputSchema: AnthropicToolSchema = {
  name: 'form_input',
  description:
    'Set values in form elements using an element reference ID from read_page or find. ' +
    'Use this instead of clicking + typing for <select>, checkboxes, radios, and date inputs — ' +
    'those do not respond reliably to synthetic typing. For plain text fields either works, but ' +
    'form_input is faster and does not depend on scroll position.',
  input_schema: {
    type: 'object',
    properties: {
      ref: {
        type: 'string',
        description: 'Element reference ID from read_page or find (e.g. "ref_1", "ref_2").',
      },
      value: {
        type: ['string', 'boolean', 'number'],
        description:
          'The value to set. For checkboxes/radios use a boolean, for selects use the option ' +
          'value or its visible text, for other inputs use a string or number.',
      },
      tabId: tabIdProp,
    },
    required: ['ref', 'value'],
  },
};

// ───────────────────────────── navigate ─────────────────────────────

export const navigateInput = z.object({
  url: z.string().min(1),
  tabId: z.number().optional(),
  force: z.boolean().optional(),
});

export const navigateSchema: AnthropicToolSchema = {
  name: 'navigate',
  description:
    'Navigate to a URL, or go forward/back in browser history. ' +
    "If you don't have a valid tab ID, use tabs_context first to get available tabs.",
  input_schema: {
    type: 'object',
    properties: {
      url: {
        type: 'string',
        description:
          'The URL to navigate to. Can be provided with or without protocol (defaults to https://). ' +
          'Use "forward" to go forward in history or "back" to go back.',
      },
      tabId: tabIdProp,
      force: {
        type: 'boolean',
        description:
          'If the page shows a "Leave site?" / beforeunload dialog, accept it and navigate. ' +
          'JS dialogs are auto-handled after debugger attach so CDP does not hang; set true when ' +
          'you intentionally discard unsaved form state. Defaults to false (same auto-accept path).',
      },
    },
    required: ['url'],
  },
};

// ───────────────────────────── tabs ─────────────────────────────

export const emptyInput = z.object({}).passthrough();

export const tabsContextSchema: AnthropicToolSchema = {
  name: 'tabs_context',
  description:
    'Get context information about all tabs available to the extension, including their tab IDs, ' +
    'URLs and titles. Call this first when you do not have a valid tab ID, or when you suspect ' +
    'the user switched tabs.',
  input_schema: { type: 'object', properties: {}, required: [] },
};

export const tabsCreateSchema: AnthropicToolSchema = {
  name: 'tabs_create',
  description:
    'Creates a new empty tab in the background and returns its tab ID. Use navigate afterwards ' +
    'to point it somewhere. The new tab is not focused, so the user keeps their current view.',
  input_schema: { type: 'object', properties: {}, required: [] },
};

export const tabsCloseInput = z.object({ tabId: z.number() });

export const tabsCloseSchema: AnthropicToolSchema = {
  name: 'tabs_close',
  description:
    'Close a tab that you opened. Only close tabs you created with tabs_create — never close ' +
    "tabs the user opened themselves, as they may contain work in progress.",
  input_schema: {
    type: 'object',
    properties: { tabId: { type: 'number', description: 'Tab ID to close.' } },
    required: ['tabId'],
  },
};

// ───────────────────────────── MCP tab group tools ─────────────────────────────
// Official names used by Desktop / Claude Code over native messaging.

export const tabsContextMcpInput = z.object({
  createIfEmpty: z.boolean().optional(),
});

export const tabsContextMcpSchema: AnthropicToolSchema = {
  name: 'tabs_context_mcp',
  description:
    'Get context information about the current MCP tab group. Returns all tab IDs inside the ' +
    'group if it exists. CRITICAL: You must get the context at least once before using other ' +
    'browser automation tools so you know what tabs exist. Each new conversation should create ' +
    'its own new tab (using tabs_create_mcp) rather than reusing existing tabs, unless the user ' +
    'explicitly asks to use an existing tab.',
  input_schema: {
    type: 'object',
    properties: {
      createIfEmpty: {
        type: 'boolean',
        description:
          'Creates a new MCP tab group if none exists (new window + orange "Claude (MCP)" group).',
      },
    },
    required: [],
  },
};

export const tabsCreateMcpSchema: AnthropicToolSchema = {
  name: 'tabs_create_mcp',
  description: 'Creates a new empty tab in the MCP tab group.',
  input_schema: { type: 'object', properties: {}, required: [] },
};

export const tabsCloseMcpInput = z.object({ tabId: z.number() });

export const tabsCloseMcpSchema: AnthropicToolSchema = {
  name: 'tabs_close_mcp',
  description:
    'Close a tab in the MCP tab group by its tab ID. Only tabs within the current session MCP ' +
    'group can be closed. Call tabs_context_mcp first to get valid tab IDs.',
  input_schema: {
    type: 'object',
    properties: {
      tabId: {
        type: 'number',
        description: 'The ID of the tab to close (must be in the MCP tab group).',
      },
    },
    required: ['tabId'],
  },
};

// ───────────────────────── read_console_messages ─────────────────────────

export const readConsoleInput = z.object({
  tabId: z.number().optional(),
  onlyErrors: z.boolean().optional(),
  clear: z.boolean().optional(),
  pattern: z.string().optional(),
  limit: z.number().int().min(1).max(500).optional(),
});

export const readConsoleSchema: AnthropicToolSchema = {
  name: 'read_console_messages',
  description:
    'Read browser console messages (console.log, console.error, console.warn, etc.) from a tab. ' +
    'Useful for debugging JavaScript errors, viewing application logs, or understanding what is ' +
    'happening in the console. IMPORTANT: always provide a pattern to filter messages — without ' +
    'one you may get hundreds of irrelevant lines. Only messages logged after the extension ' +
    'attached to the tab are captured; reload the page if you need earlier output.',
  input_schema: {
    type: 'object',
    properties: {
      tabId: tabIdProp,
      onlyErrors: {
        type: 'boolean',
        description: 'If true, only return error and exception messages. Default false.',
      },
      clear: {
        type: 'boolean',
        description:
          'If true, clear the captured messages after reading to avoid duplicates on subsequent calls. Default false.',
      },
      pattern: {
        type: 'string',
        description:
          "Regex pattern to filter messages (e.g. 'error|warning', 'MyApp'). Always provide one.",
      },
      limit: {
        type: 'number',
        description: 'Maximum number of messages to return. Defaults to 100.',
      },
    },
  },
};

// ───────────────────────── read_network_requests ─────────────────────────

export const readNetworkInput = z.object({
  tabId: z.number().optional(),
  urlPattern: z.string().optional(),
  method: z.string().optional(),
  statusMin: z.number().int().optional(),
  onlyFailed: z.boolean().optional(),
  includeBody: z.boolean().optional(),
  clear: z.boolean().optional(),
  limit: z.number().int().min(1).max(300).optional(),
});

export const readNetworkSchema: AnthropicToolSchema = {
  name: 'read_network_requests',
  description:
    'Read HTTP network requests (XHR, fetch, documents, images) made by a tab. Useful for ' +
    'debugging API calls and understanding what requests a page makes. Requests are captured ' +
    'only while the extension is attached, and are cleared when the page navigates to a ' +
    'different origin. This can expose authentication tokens and personal data, so it requires ' +
    'explicit user permission every session.',
  input_schema: {
    type: 'object',
    properties: {
      tabId: tabIdProp,
      urlPattern: {
        type: 'string',
        description:
          "Only return requests whose URL contains this string (e.g. '/api/' or 'example.com').",
      },
      method: { type: 'string', description: "Filter by HTTP method (e.g. 'POST')." },
      statusMin: {
        type: 'number',
        description: 'Only return responses with status >= this value (e.g. 400 for errors).',
      },
      onlyFailed: {
        type: 'boolean',
        description: 'If true, only return requests that failed or returned status >= 400.',
      },
      includeBody: {
        type: 'boolean',
        description:
          'If true, include response bodies (truncated). Expensive — only use when you need to ' +
          'inspect a specific API response, ideally combined with urlPattern.',
      },
      clear: {
        type: 'boolean',
        description: 'If true, clear captured requests after reading. Default false.',
      },
      limit: { type: 'number', description: 'Maximum number of requests to return. Defaults to 100.' },
    },
  },
};

// ───────────────────────────── javascript_tool ─────────────────────────────

export const javascriptInput = z.object({
  action: z.literal('javascript_exec'),
  text: z.string().min(1),
  tabId: z.number().optional(),
});

export const javascriptSchema: AnthropicToolSchema = {
  name: 'javascript_tool',
  description:
    "Execute JavaScript in the page's context. Returns the value of the last expression or any " +
    'thrown error. Use this only when the other tools genuinely cannot do the job — it is the ' +
    'most powerful and least reviewable tool available, so the user has to approve every call ' +
    'and cannot grant it permanently.',
  input_schema: {
    type: 'object',
    properties: {
      action: { type: 'string', description: "Must be set to 'javascript_exec'." },
      text: {
        type: 'string',
        description:
          'The JavaScript code to execute. Evaluated in the page context with REPL semantics: ' +
          'top-level `await` works, and the result of the last expression is returned automatically ' +
          '— write the expression you want (e.g. `window.myData.value`, or ' +
          '`await fetch(url).then(r => r.json())`) rather than `return ...`.',
      },
      tabId: tabIdProp,
    },
    required: ['action', 'text'],
  },
};

// ───────────────────────────── resize_window ─────────────────────────────

export const resizeWindowInput = z.object({
  width: z.number().int().min(200).max(10_000),
  height: z.number().int().min(200).max(10_000),
  tabId: z.number().optional(),
});

export const resizeWindowSchema: AnthropicToolSchema = {
  name: 'resize_window',
  description:
    'Resize the browser window containing the given tab. Useful for testing responsive layouts ' +
    'or making more of a long page visible at once.',
  input_schema: {
    type: 'object',
    properties: {
      width: { type: 'number', description: 'Target window width in pixels.' },
      height: { type: 'number', description: 'Target window height in pixels.' },
      tabId: tabIdProp,
    },
    required: ['width', 'height'],
  },
};

// ───────────────────────────── update_plan ─────────────────────────────

export const updatePlanInput = z.object({
  domains: z.array(z.string()),
  approach: z.array(z.string()),
});

export const updatePlanSchema: AnthropicToolSchema = {
  name: 'update_plan',
  description:
    'Update the plan and present it to the user for approval before proceeding. ' +
    'In Ask-before-acting mode this must be called (and approved) before any other tool. ' +
    'After approval, ordinary actions on the listed domains can proceed for this turn; ' +
    'irreversible actions, JavaScript, and uploads still require separate confirmation.',
  input_schema: {
    type: 'object',
    properties: {
      domains: {
        type: 'array',
        items: { type: 'string' },
        description:
          'Websites/domains you plan to visit (e.g. ["github.com", "stackoverflow.com"] or full URLs). ' +
          'Leave empty only if not applicable.',
      },
      approach: {
        type: 'array',
        items: { type: 'string' },
        description:
          'Ordered high-level steps you will follow (e.g. ["Navigate to homepage", ' +
          '"Search for documentation", "Extract key information"]). Outcome-focused, ' +
          'no browser tool names. Be concise — aim for 3-7 steps.',
      },
    },
    required: ['domains', 'approach'],
  },
};

// ───────────────────────────── todowrite ─────────────────────────────

export const TODO_STATUSES = ['pending', 'in_progress', 'completed', 'cancelled'] as const;

export const todoWriteInput = z.object({
  todos: z
    .array(
      z.object({
        id: z.string().min(1),
        content: z.string().min(1),
        status: z.enum(TODO_STATUSES),
      }),
    )
    .min(1)
    .max(20),
});

export const todoWriteSchema: AnthropicToolSchema = {
  name: 'todowrite',
  description:
    'Update the checklist shown to the user in the side panel. Use this for multi-step tasks so ' +
    'the user can see progress. Replace the entire list each call (not a diff). Keep 3–8 items. ' +
    'Mark exactly one item in_progress at a time when work is ongoing.',
  input_schema: {
    type: 'object',
    properties: {
      todos: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string', description: 'Stable id for this item across updates.' },
            content: { type: 'string', description: 'Short human-readable step.' },
            status: {
              type: 'string',
              enum: [...TODO_STATUSES],
              description: 'pending | in_progress | completed | cancelled',
            },
          },
          required: ['id', 'content', 'status'],
        },
        description: 'Full replacement list of todo items.',
      },
    },
    required: ['todos'],
  },
};

// ───────────────────────────── browser_batch ─────────────────────────────

export const browserBatchInput = z.object({
  actions: z
    .array(
      z.object({
        name: z.string().min(1),
        input: z.record(z.unknown()).default({}),
      }),
    )
    .min(1)
    .max(20),
});

export const browserBatchSchema: AnthropicToolSchema = {
  name: 'browser_batch',
  description:
    'Execute a sequence of browser tool calls in ONE round trip. Actions run SEQUENTIALLY ' +
    '(not in parallel) and stop on the first error. Prefer this whenever you can predict two or ' +
    'more steps (click→type→key, form fills, multi-step navigation) — it is significantly faster. ' +
    'browser_batch cannot be nested. ' +
    'IMPORTANT: steps that still need a fresh user permission grant will fail inside a batch — ' +
    'call that tool once standalone so the user is prompted, then batch the rest. ' +
    'Coordinates you write in THIS batch refer to the screenshot taken BEFORE this call ' +
    '(mid-batch screenshots are returned for verification but are not the coordinate basis).',
  input_schema: {
    type: 'object',
    properties: {
      actions: {
        type: 'array',
        minItems: 1,
        maxItems: 20,
        description:
          'List of tool calls to execute sequentially. Example: ' +
          '[{"name":"computer","input":{"action":"left_click","ref":"ref_1"}},' +
          '{"name":"computer","input":{"action":"type","text":"hello"}}]',
        items: {
          type: 'object',
          properties: {
            name: {
              type: 'string',
              description:
                'Tool name (e.g. computer, navigate, find, form_input, tabs_create). ' +
                'browser_batch cannot be nested.',
            },
            input: {
              type: 'object',
              description: "That tool's input — same shape you'd pass when calling it directly.",
            },
          },
          required: ['name', 'input'],
        },
      },
    },
    required: ['actions'],
  },
};

// ───────────────────────────── upload_image ─────────────────────────────

export const uploadImageInput = z
  .object({
    imageId: z.string().min(1),
    ref: z.string().optional(),
    coordinate: z.tuple([z.number(), z.number()]).optional(),
    tabId: z.number().optional(),
    filename: z.string().optional(),
  })
  .superRefine((v, ctx) => {
    if (!v.ref && !v.coordinate) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Provide either ref (file input / element) or coordinate (drag & drop), not neither.',
      });
    }
    if (v.ref && v.coordinate) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['ref'],
        message: 'Provide ref or coordinate, not both.',
      });
    }
  });

export const uploadImageSchema: AnthropicToolSchema = {
  name: 'upload_image',
  description:
    'Upload a previously captured screenshot or user-attached image to a file input or drag & drop ' +
    'target. Use imageId from a computer screenshot output (or a user attachment note). ' +
    'Provide either ref (preferred for <input type="file">, including hidden ones) or coordinate ' +
    '(for visible drop targets like Google Docs), not both. ' +
    'Do NOT click file inputs — the native picker is invisible to you.',
  input_schema: {
    type: 'object',
    properties: {
      imageId: {
        type: 'string',
        description:
          'ID of a previously captured screenshot (from computer screenshot output, e.g. img_3) ' +
          'or a user-attached image.',
      },
      ref: {
        type: 'string',
        description:
          'Element reference from read_page/find (e.g. ref_1). Use for file inputs or specific elements.',
      },
      coordinate: {
        type: 'array',
        items: { type: 'number' },
        minItems: 2,
        maxItems: 2,
        description: 'Viewport coordinates [x, y] for drag & drop to a visible location.',
      },
      tabId: tabIdProp,
      filename: {
        type: 'string',
        description: 'Optional filename for the uploaded file (default: image.png).',
      },
    },
    required: ['imageId'],
  },
};

// ───────────────────────────── file_upload ─────────────────────────────

const filePart = z.object({
  data: z.string().min(1),
  name: z.string().min(1),
  mimeType: z.string().optional(),
});

export const fileUploadInput = z
  .object({
    files: z.array(filePart).optional(),
    fileIds: z.array(z.string().min(1)).optional(),
    ref: z.string().min(1),
    tabId: z.number().optional(),
    paths: z.array(z.string()).optional(),
  })
  .superRefine((v, ctx) => {
    if (v.paths && v.paths.length > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['paths'],
        message:
          'file_upload no longer accepts host filesystem paths. Pass base64 via `files` or catalog `fileIds`.',
      });
    }
    const nFiles = v.files?.length ?? 0;
    const nIds = v.fileIds?.length ?? 0;
    if (nFiles + nIds < 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['files'],
        message: 'Provide at least one entry in `files` (base64) or `fileIds` (from user attachments).',
      });
    }
  });

export const fileUploadSchema: AnthropicToolSchema = {
  name: 'file_upload',
  description:
    'Upload one or multiple files to a file input element on the page. ' +
    'Do not click file upload buttons or file inputs — clicking opens a native file picker you cannot see. ' +
    'Locate the input with read_page/find, then pass its ref here. ' +
    'Supply file bytes as base64 in `files`, or `fileIds` from user attachments in the side panel.',
  input_schema: {
    type: 'object',
    properties: {
      files: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            data: { type: 'string', description: 'Base64-encoded file contents (no data: prefix).' },
            name: { type: 'string', description: 'Filename shown to the page.' },
            mimeType: { type: 'string', description: 'MIME type (default application/octet-stream).' },
          },
          required: ['data', 'name'],
        },
        description: 'Files to upload as base64-encoded bytes.',
      },
      fileIds: {
        type: 'array',
        items: { type: 'string' },
        description: 'Catalog ids of user-attached files (from the side panel attachment chips).',
      },
      ref: {
        type: 'string',
        description: 'Element reference ID of the file input from read_page or find (e.g. ref_1).',
      },
      tabId: tabIdProp,
    },
    required: ['ref'],
  },
};

// ───────────────────────────── gif_creator ─────────────────────────────

export const GIF_ACTIONS = ['start_recording', 'stop_recording', 'export', 'clear'] as const;

export const gifCreatorInput = z
  .object({
    action: z.enum(GIF_ACTIONS),
    tabId: z.number().optional(),
    coordinate: z.tuple([z.number(), z.number()]).optional(),
    download: z.boolean().optional(),
    filename: z.string().optional(),
    options: z
      .object({
        showActionLabels: z.boolean().optional(),
        quality: z.number().min(1).max(30).optional(),
      })
      .optional(),
  })
  .superRefine((v, ctx) => {
    if (v.action === 'export' && !v.download && !v.coordinate) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "export requires download: true and/or coordinate for drag/drop upload.",
      });
    }
  });

export const gifCreatorSchema: AnthropicToolSchema = {
  name: 'gif_creator',
  description:
    'Manage GIF recording and export for browser automation. ' +
    "Actions: 'start_recording' (begin capturing computer/navigate frames, max 50), " +
    "'stop_recording' (keep frames), 'export' (build GIF — set download:true and/or coordinate), " +
    "'clear' (discard). After start, take a screenshot for the first frame; before stop, screenshot for the last.",
  input_schema: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: [...GIF_ACTIONS],
        description: 'start_recording | stop_recording | export | clear',
      },
      tabId: tabIdProp,
      coordinate: {
        type: 'array',
        items: { type: 'number' },
        minItems: 2,
        maxItems: 2,
        description: 'Viewport [x,y] to drag/drop the GIF onto the page (export).',
      },
      download: {
        type: 'boolean',
        description: 'If true, download the GIF via the browser downloads UI (export).',
      },
      filename: { type: 'string', description: "Export filename (default recording-<timestamp>.gif)." },
      options: {
        type: 'object',
        properties: {
          showActionLabels: { type: 'boolean' },
          quality: { type: 'number', description: '1–30, lower is higher quality (default 10).' },
        },
      },
    },
    required: ['action'],
  },
};

// ───────────────────────────── shortcuts ─────────────────────────────

export const shortcutsListSchema: AnthropicToolSchema = {
  name: 'shortcuts_list',
  description:
    'List all available shortcuts and workflows. Returns id, command, title, description. ' +
    'Use shortcuts_execute to run one.',
  input_schema: { type: 'object', properties: {}, required: [] },
};

export const shortcutsExecuteInput = z
  .object({
    shortcutId: z.string().optional(),
    command: z.string().optional(),
  })
  .superRefine((v, ctx) => {
    if (!v.shortcutId && !v.command) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Either shortcutId or command is required. Use shortcuts_list first.',
      });
    }
  });

export const shortcutsExecuteSchema: AnthropicToolSchema = {
  name: 'shortcuts_execute',
  description:
    'Execute a shortcut/workflow by id or command name (without leading slash). ' +
    'Starts a new turn in the current side panel with the shortcut prompt and returns immediately.',
  input_schema: {
    type: 'object',
    properties: {
      shortcutId: { type: 'string', description: 'Shortcut id from shortcuts_list.' },
      command: {
        type: 'string',
        description: "Command name without leading slash (e.g. 'summarize').",
      },
    },
  },
};

/**
 * zod 错误 → 给模型的可操作文案。
 *
 * 只取第一个 issue：一次给一个明确的修复目标，模型改对的概率最高。
 * 全给出来它容易只修其中一个然后重试失败。
 */
export function formatZodError(err: z.ZodError, toolName: string): string {
  const issue = err.issues[0];
  const path = issue?.path.join('.') || 'input';
  return `Invalid ${toolName} input: ${path}: ${issue?.message ?? 'malformed'}`;
}
