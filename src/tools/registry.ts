/**
 * 工具注册表 + 全部工具实现。
 *
 * 统一约定（每个工具都遵守）：
 *  1. **永远不抛异常给 agent loop。** 所有失败都变成 `{ error }` 回灌给模型。
 *     抛异常等于让模型什么都看不到，它只会原样重试。
 *  2. **错误文案是写给模型看的**，必须包含"下一步该怎么办"。
 *     "Element not found" 没用；"Element ref_3 no longer exists, call read_page again" 有用。
 *  3. **权限检查在动作之前**，而且是 await 用户回答，不是先做后问。
 *  4. **返回 tabContext**，让模型始终知道自己在哪个 tab 上。
 */

import type {
  Permission,
  ToolContext,
  ToolResult,
} from '@/shared/types';
import { PERMISSION } from '@/shared/types';
import { ACTION_PERMISSION, NO_PERMISSION_ACTIONS } from '@/permissions/rules';
import { peekSettings } from '@/storage/settings';
import * as cdp from '@/cdp/session';
import * as input from '@/cdp/input';
import * as shot from '@/cdp/screenshot';
import * as obs from '@/cdp/observers';
import {
  buildTabContext,
  delay,
  ensureAgentTabGrouped,
  formatTabs,
  getEffectiveTabId,
  getTab,
  getTabUrl,
  hideIndicator,
  sendToPage,
  showIndicator,
  waitForLoad,
} from './tabs';
import {
  type AnthropicToolSchema,
  computerInput,
  computerSchema,
  emptyInput,
  findInput,
  findSchema,
  formatZodError,
  formInputInput,
  formInputSchema,
  getPageTextInput,
  getPageTextSchema,
  javascriptInput,
  javascriptSchema,
  navigateInput,
  navigateSchema,
  readConsoleInput,
  readConsoleSchema,
  readNetworkInput,
  readNetworkSchema,
  readPageInput,
  readPageSchema,
  resizeWindowInput,
  resizeWindowSchema,
  tabsCloseInput,
  tabsCloseSchema,
  tabsContextSchema,
  tabsCreateSchema,
  todoWriteInput,
  todoWriteSchema,
  updatePlanInput,
  updatePlanSchema,
} from './schemas';
import { setTodos } from '@/sidepanel/state/todos';
import { putScreenshot } from '@/media/catalog';
import { createBrowserBatchTool } from './batch';
import { createUploadImageTool, createFileUploadTool } from './upload';
import { createGifCreatorTool, maybeCaptureGifFrame } from './gif';
import { createShortcutsExecuteTool, createShortcutsListTool } from './shortcuts';
import type { z } from 'zod';

export interface Tool {
  name: string;
  schema: AnthropicToolSchema;
  /** 入参校验器 */
  parse: (raw: unknown) => { ok: true; value: unknown } | { ok: false; error: string };
  run: (args: never, ctx: ToolContext) => Promise<ToolResult>;
  /** 需要设置开关才可用（javascript_tool） */
  gated?: (s: ReturnType<typeof peekSettings>) => boolean;
}

/** 把 zod schema 包成统一的 parse。 */
function parser<T extends z.ZodTypeAny>(schema: T, name: string) {
  return (raw: unknown): { ok: true; value: z.infer<T> } | { ok: false; error: string } => {
    const r = schema.safeParse(raw ?? {});
    if (r.success) return { ok: true, value: r.data };
    return { ok: false, error: formatZodError(r.error, name) };
  };
}

/**
 * 权限 + attach 的通用前置。
 *
 * 返回 null 表示可以继续；返回 ToolResult 表示应当直接把它回灌给模型。
 * 这个函数是所有页面工具的唯一入口 —— 绕过它就绕过了权限。
 */
async function guard(
  ctx: ToolContext,
  tabId: number,
  permission: Permission,
  actionLabel: string,
  extra: { screenshot?: string; actionData?: unknown } = {},
): Promise<ToolResult | null> {
  let url: string;
  try {
    url = await getTabUrl(tabId);
  } catch (e) {
    return { error: msg(e) };
  }

  const decision = await ctx.requestPermission(permission, {
    actionLabel,
    url,
    ...extra,
  });

  if (!decision.allowed) {
    return {
      error:
        decision.reason ??
        `The user did not grant permission to ${actionLabel} on ${url}. Do not retry the same action.`,
    };
  }

  if (ctx.signal.aborted) return { error: 'Stopped by the user.' };
  return null;
}

/** attach debugger，把失败翻译成模型能处理的话。 */
async function ensureAttached(tabId: number): Promise<ToolResult | null> {
  try {
    await cdp.attach(tabId);
    return null;
  } catch (e) {
    return { error: msg(e) };
  }
}

function msg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** 每个动作后附上 tab 上下文，模型才知道自己在哪。 */
async function withContext(
  ctx: ToolContext,
  result: ToolResult,
  executedOnTabId?: number,
): Promise<ToolResult> {
  try {
    result.tabContext = await buildTabContext(ctx.tabId, executedOnTabId);
  } catch {
    /* tab 上下文拿不到不该让工具失败 */
  }
  return result;
}

// ════════════════════════════ computer ════════════════════════════

/**
 * 把 ref 解析成视口坐标。
 *
 * 如果元素在视口外，先滚进来再取坐标 —— CDP 的 Input 事件是按视口坐标派发的，
 * 对着视口外的坐标点击会点到别的东西上。这是 ref 相对裸坐标最大的优势。
 */
async function resolveTarget(
  tabId: number,
  ref: string,
): Promise<{ ok: true; x: number; y: number } | { ok: false; error: string }> {
  type RefRes = {
    ok: boolean;
    error?: string;
    center?: [number, number];
    inViewport?: boolean;
  };

  let res: RefRes;
  try {
    res = await sendToPage<RefRes>(tabId, { type: 'AGENT_RESOLVE_REF', refId: ref });
  } catch (e) {
    return { ok: false, error: msg(e) };
  }

  if (!res.ok || !res.center) {
    return { ok: false, error: res.error ?? `Could not resolve ${ref}.` };
  }

  if (!res.inViewport) {
    try {
      await sendToPage(tabId, { type: 'AGENT_SCROLL_REF', refId: ref });
      await delay(180); // 等平滑滚动/懒加载稳定
      const again = await sendToPage<RefRes>(tabId, { type: 'AGENT_RESOLVE_REF', refId: ref });
      if (again.ok && again.center) return { ok: true, x: again.center[0], y: again.center[1] };
    } catch {
      /* 滚动失败就用原坐标试 */
    }
  }

  return { ok: true, x: res.center[0], y: res.center[1] };
}

const computerTool: Tool = {
  name: 'computer',
  schema: computerSchema,
  parse: parser(computerInput, 'computer'),
  async run(args: z.infer<typeof computerInput>, ctx) {
    let tabId: number;
    try {
      tabId = await getEffectiveTabId(args.tabId, ctx.tabId);
    } catch (e) {
      return { error: msg(e) };
    }

    const action = args.action;

    // 权限：screenshot/zoom/wait/scroll_to 不需要问
    if (!NO_PERMISSION_ACTIONS.has(action)) {
      const permission = ACTION_PERMISSION[action] ?? PERMISSION.CLICK;
      const label = describeAction(args);
      const blocked = await guard(ctx, tabId, permission, label, { actionData: args });
      if (blocked) return blocked;
    }

    const attachErr = await ensureAttached(tabId);
    if (attachErr) return attachErr;

    try {
      switch (action) {
        case 'screenshot': {
          await hideIndicator(tabId);
          await delay(80);
          const s = await shot.capture(tabId);
          const entry = putScreenshot({
            data: s.data,
            mediaType: s.mediaType,
            width: s.width,
            height: s.height,
            tabId,
          });
          const parts = [
            `Screenshot of tab ${tabId} (${s.width}x${s.height} as shown to you). imageId: ${entry.id}.`,
          ];
          if (s.truncatedNote) parts.push(s.truncatedNote);
          parts.push('Pass this imageId to upload_image if you need to upload the screenshot to a page.');
          return withContext(
            ctx,
            {
              output: parts.join(' '),
              images: [{ mediaType: s.mediaType, data: s.data }],
            },
            tabId,
          );
        }

        case 'zoom': {
          await hideIndicator(tabId);
          await delay(80);
          const region = args.region!;
          const s = await shot.captureRegion(tabId, region);
          const entry = putScreenshot({
            data: s.data,
            mediaType: s.mediaType,
            width: s.width,
            height: s.height,
            tabId,
          });
          return withContext(
            ctx,
            {
              output:
                `Zoomed view of region [${region.join(', ')}] on tab ${tabId} (imageId: ${entry.id}). ` +
                `IMPORTANT: coordinates in this magnified image do NOT match the real page. ` +
                `To click something you see here, take a normal screenshot first (or use read_page ` +
                `and a ref), then give coordinates from that.`,
              images: [{ mediaType: s.mediaType, data: s.data }],
            },
            tabId,
          );
        }

        case 'wait': {
          const secs = Math.min(args.duration ?? 1, 10);
          await delay(secs * 1000);
          return withContext(ctx, { output: `Waited ${secs} second(s).` }, tabId);
        }

        case 'scroll_to': {
          const r = await sendToPage<{ ok: boolean; error?: string }>(tabId, {
            type: 'AGENT_SCROLL_REF',
            refId: args.ref!,
          });
          if (!r.ok) return { error: r.error ?? `Could not scroll to ${args.ref}.` };
          await delay(150);
          return withContext(ctx, { output: `Scrolled ${args.ref} into view.` }, tabId);
        }

        case 'scroll': {
          await showIndicator(tabId, 'Scrolling');
          const [x, y] = shot.toCssCoordinates(tabId, args.coordinate![0], args.coordinate![1]);
          await input.scroll(tabId, x, y, args.scroll_direction!, args.scroll_amount ?? 3);
          await delay(180); // 等无限滚动之类的内容加载
          void maybeCaptureGifFrame(tabId, `scroll_${args.scroll_direction}`);
          return withContext(
            ctx,
            {
              output: `Scrolled ${args.scroll_direction} by ${args.scroll_amount ?? 3} ticks. Take a screenshot to see the result.`,
            },
            tabId,
          );
        }

        case 'hover': {
          const pos = await positionFor(tabId, args);
          if ('error' in pos) return { error: pos.error };
          await showIndicator(tabId, 'Hovering');
          await input.mouseMove(tabId, pos.x, pos.y);
          await delay(220); // tooltip / 下拉菜单需要时间出现
          return withContext(
            ctx,
            { output: `Moved the cursor to (${pos.x}, ${pos.y}). Take a screenshot to see what appeared.` },
            tabId,
          );
        }

        case 'left_click':
        case 'right_click':
        case 'double_click':
        case 'triple_click': {
          const pos = await positionFor(tabId, args);
          if ('error' in pos) return { error: pos.error };

          const button = action === 'right_click' ? 'right' : 'left';
          const clickCount = action === 'double_click' ? 2 : action === 'triple_click' ? 3 : 1;

          await showIndicator(tabId, 'Clicking');
          await input.click(tabId, pos.x, pos.y, {
            button,
            clickCount,
            modifiers: input.parseModifiers(args.modifiers),
          });

          // 点击常触发导航或异步渲染，给一点时间但不要等满
          await delay(220);
          const dialogs = obs.drainDialogs(tabId);
          const extra = dialogs.length
            ? ` A JavaScript dialog appeared and was accepted: ${dialogs
                .map((d) => `${d.type}: ${d.message}`)
                .join(' | ')}`
            : '';

          void maybeCaptureGifFrame(tabId, action);
          return withContext(
            ctx,
            {
              output:
                `${action} at (${pos.x}, ${pos.y}) on tab ${tabId}.${extra} ` +
                `Take a screenshot or call read_page to see the result.`,
            },
            tabId,
          );
        }

        case 'left_click_drag': {
          const [sx, sy] = shot.toCssCoordinates(
            tabId,
            args.start_coordinate![0],
            args.start_coordinate![1],
          );
          const [ex, ey] = shot.toCssCoordinates(tabId, args.coordinate![0], args.coordinate![1]);
          await showIndicator(tabId, 'Dragging');
          await input.drag(tabId, [sx, sy], [ex, ey], {
            modifiers: input.parseModifiers(args.modifiers),
          });
          await delay(200);
          void maybeCaptureGifFrame(tabId, 'left_click_drag');
          return withContext(
            ctx,
            { output: `Dragged from (${sx}, ${sy}) to (${ex}, ${ey}).` },
            tabId,
          );
        }

        case 'type': {
          await showIndicator(tabId, 'Typing');
          await input.typeText(tabId, args.text!);
          await delay(120);
          void maybeCaptureGifFrame(tabId, 'type');
          return withContext(
            ctx,
            {
              output:
                `Typed ${args.text!.length} character(s) into the focused element. ` +
                `If nothing appeared, click the field first — typing goes to whatever has focus.`,
            },
            tabId,
          );
        }

        case 'key': {
          await showIndicator(tabId, 'Pressing keys');
          await input.pressKeys(tabId, args.text!, args.repeat ?? 1);
          await delay(160);
          const dialogs = obs.drainDialogs(tabId);
          const extra = dialogs.length
            ? ` A JavaScript dialog appeared and was accepted: ${dialogs
                .map((d) => `${d.type}: ${d.message}`)
                .join(' | ')}`
            : '';
          void maybeCaptureGifFrame(tabId, 'key');
          return withContext(
            ctx,
            { output: `Pressed "${args.text}"${args.repeat && args.repeat > 1 ? ` x${args.repeat}` : ''}.${extra}` },
            tabId,
          );
        }

        default:
          return { error: `Unsupported action: ${action}` };
      }
    } catch (e) {
      return { error: `Failed to execute ${action}: ${msg(e)}` };
    } finally {
      void hideIndicator(tabId);
    }
  },
};

/** ref 优先于 coordinate；两者都没有时由 zod 拦下了，这里只做兜底。 */
async function positionFor(
  tabId: number,
  args: z.infer<typeof computerInput>,
): Promise<{ x: number; y: number } | { error: string }> {
  if (args.ref) {
    const r = await resolveTarget(tabId, args.ref);
    return r.ok ? { x: r.x, y: r.y } : { error: r.error };
  }
  if (args.coordinate) {
    const [x, y] = shot.toCssCoordinates(tabId, args.coordinate[0], args.coordinate[1]);
    return { x, y };
  }
  return { error: 'Provide either coordinate [x, y] or ref.' };
}

/** 生成给用户看的动作描述。授权气泡上显示的就是这句。 */
function describeAction(args: z.infer<typeof computerInput>): string {
  switch (args.action) {
    case 'type':
      return `Type "${truncate(args.text ?? '', 60)}"`;
    case 'key':
      return `Press ${args.text}`;
    case 'scroll':
      return `Scroll ${args.scroll_direction}`;
    case 'left_click_drag':
      return 'Drag on the page';
    default:
      return `${args.action.replace(/_/g, ' ')}${args.ref ? ` on ${args.ref}` : ''}`;
  }
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

// ════════════════════════════ read_page ════════════════════════════

const readPageTool: Tool = {
  name: 'read_page',
  schema: readPageSchema,
  parse: parser(readPageInput, 'read_page'),
  async run(args: z.infer<typeof readPageInput>, ctx) {
    let tabId: number;
    try {
      tabId = await getEffectiveTabId(args.tabId, ctx.tabId);
    } catch (e) {
      return { error: msg(e) };
    }

    const blocked = await guard(ctx, tabId, PERMISSION.READ_PAGE_CONTENT, 'Read this page');
    if (blocked) return blocked;

    try {
      const res = await sendToPage<{
        pageContent: string;
        viewport: { width: number; height: number };
        error?: string;
      }>(tabId, {
        type: 'AGENT_GENERATE_TREE',
        options: {
          filter: args.filter ?? 'all',
          maxDepth: args.depth,
          maxChars: args.max_chars,
          refId: args.ref_id ?? null,
        },
      });

      if (res.error) return { error: res.error };
      if (!res.pageContent.trim()) {
        return {
          error:
            'The accessibility tree is empty. The page may render into a canvas or a closed shadow root — ' +
            'try the computer tool with a screenshot instead.',
        };
      }

      const tab = await getTab(tabId);
      const header =
        `Page: ${tab.title ?? ''}\nURL: ${tab.url ?? ''}\n` +
        `Viewport: ${res.viewport.width}x${res.viewport.height}\n\n`;

      return withContext(ctx, { output: header + res.pageContent }, tabId);
    } catch (e) {
      return { error: msg(e) };
    }
  },
};

// ════════════════════════════ find ════════════════════════════

/**
 * find 的实现思路和原版一致：**先拿全量 a11y 树，再让小模型挑**。
 *
 * 为什么不在页面里做字符串匹配：用户说的是 "the checkout button"，
 * 页面上写的可能是 "Proceed to payment"。纯文本匹配完全无效。
 *
 * 与原版的区别：原版用 `modelClass: "small_fast"` 调官方端点。我们走中转站，
 * 不保证有小模型可用，所以退化策略是**本地模糊匹配**（Fuse.js 在 UI 层，
 * 这里用轻量打分），不让 find 因为没有小模型就整个不能用。
 */
const findTool: Tool = {
  name: 'find',
  schema: findSchema,
  parse: parser(findInput, 'find'),
  async run(args: z.infer<typeof findInput>, ctx) {
    let tabId: number;
    try {
      tabId = await getEffectiveTabId(args.tabId, ctx.tabId);
    } catch (e) {
      return { error: msg(e) };
    }

    const blocked = await guard(ctx, tabId, PERMISSION.READ_PAGE_CONTENT, `Find "${args.query}"`);
    if (blocked) return blocked;

    try {
      const res = await sendToPage<{ pageContent: string; error?: string }>(tabId, {
        type: 'AGENT_GENERATE_TREE',
        options: { filter: 'all', maxChars: 200_000 },
      });
      if (res.error) return { error: res.error };

      const matches = scoreLines(res.pageContent, args.query);
      if (matches.length === 0) {
        return withContext(
          ctx,
          {
            output:
              `No elements matched "${args.query}". The page may use different wording — ` +
              `call read_page with filter="interactive" to see what is actually there.`,
          },
          tabId,
        );
      }

      const shown = matches.slice(0, 20);
      const head =
        `FOUND: ${matches.length}\nSHOWING: ${shown.length}\n\n` +
        (matches.length > 20
          ? 'More than 20 elements matched; refine your query to narrow it down.\n\n'
          : '');

      return withContext(ctx, { output: head + shown.map((m) => m.line).join('\n') }, tabId);
    } catch (e) {
      return { error: msg(e) };
    }
  },
};

/**
 * 轻量相关度打分。
 *
 * 只在带 [ref_N] 的行里找 —— 没有 ref 的行模型也用不了。
 * 评分规则刻意简单：全词命中 > 前缀命中 > 子串命中，再按命中词数加权。
 * 复杂的排序算法在这里收益很低，因为模型自己会从 20 个候选里挑。
 */
function scoreLines(tree: string, query: string): Array<{ line: string; score: number }> {
  const terms = query
    .toLowerCase()
    .split(/[\s,._-]+/)
    .filter((t) => t.length > 1);
  if (terms.length === 0) return [];

  const out: Array<{ line: string; score: number }> = [];

  for (const raw of tree.split('\n')) {
    if (!raw.includes('[ref_')) continue;
    const line = raw.trim();
    const hay = line.toLowerCase();

    let score = 0;
    for (const t of terms) {
      const idx = hay.indexOf(t);
      if (idx === -1) continue;
      score += 1;
      // 词边界命中权重更高
      if (new RegExp(`\\b${escapeRe(t)}\\b`).test(hay)) score += 2;
    }
    if (score === 0) continue;

    // 命中所有词的强力加分
    if (terms.every((t) => hay.includes(t))) score += terms.length * 2;
    // 短行通常是更精确的目标（"button \"Buy\"" 优于一整段文字）
    if (line.length < 120) score += 1;

    out.push({ line, score });
  }

  return out.sort((a, b) => b.score - a.score);
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ════════════════════════════ get_page_text ════════════════════════════

const getPageTextTool: Tool = {
  name: 'get_page_text',
  schema: getPageTextSchema,
  parse: parser(getPageTextInput, 'get_page_text'),
  async run(args: z.infer<typeof getPageTextInput>, ctx) {
    let tabId: number;
    try {
      tabId = await getEffectiveTabId(args.tabId, ctx.tabId);
    } catch (e) {
      return { error: msg(e) };
    }

    const blocked = await guard(ctx, tabId, PERMISSION.READ_PAGE_CONTENT, 'Read this page');
    if (blocked) return blocked;

    try {
      const res = await sendToPage<{ text: string; title: string; url: string }>(tabId, {
        type: 'AGENT_EXTRACT_TEXT',
        maxChars: args.max_chars ?? 50_000,
      });

      if (!res.text.trim()) {
        return {
          error:
            'No readable text found. The page may be image-, video-, or canvas-based — ' +
            'use the computer tool with a screenshot instead.',
        };
      }

      return withContext(
        ctx,
        { output: `Title: ${res.title}\nURL: ${res.url}\n\n${res.text}` },
        tabId,
      );
    } catch (e) {
      return { error: msg(e) };
    }
  },
};

// ════════════════════════════ form_input ════════════════════════════

const formInputTool: Tool = {
  name: 'form_input',
  schema: formInputSchema,
  parse: parser(formInputInput, 'form_input'),
  async run(args: z.infer<typeof formInputInput>, ctx) {
    let tabId: number;
    try {
      tabId = await getEffectiveTabId(args.tabId, ctx.tabId);
    } catch (e) {
      return { error: msg(e) };
    }

    const blocked = await guard(
      ctx,
      tabId,
      PERMISSION.TYPE,
      `Set ${args.ref} to "${truncate(String(args.value), 60)}"`,
      { actionData: args },
    );
    if (blocked) return blocked;

    try {
      await showIndicator(tabId, 'Filling in a field');
      const [res] = await chrome.scripting.executeScript({
        target: { tabId, frameIds: [0] },
        world: 'MAIN',
        args: [args.ref, args.value as string | number | boolean],
        // 在 MAIN world 执行才能拿到 __agentElementMap（content script 也在 MAIN）
        func: (ref: string, value: string | number | boolean) => {
          const w = window as unknown as {
            __agentElementMap?: Record<string, WeakRef<Element>>;
          };
          const el = w.__agentElementMap?.[ref]?.deref() as
            | HTMLInputElement
            | HTMLTextAreaElement
            | HTMLSelectElement
            | undefined;

          if (!el || !document.contains(el)) {
            return { ok: false, error: `Element "${ref}" no longer exists. Call read_page again.` };
          }

          const tag = el.tagName.toLowerCase();
          const type = (el as HTMLInputElement).type?.toLowerCase();

          // React/Vue 只监听原生 setter 的变更；直接赋 .value 它们收不到。
          const setNative = (node: HTMLElement, prop: string, v: unknown) => {
            const proto = Object.getPrototypeOf(node);
            const desc = Object.getOwnPropertyDescriptor(proto, prop);
            if (desc?.set) desc.set.call(node, v);
            else (node as unknown as Record<string, unknown>)[prop] = v;
          };

          const fire = (node: HTMLElement) => {
            node.dispatchEvent(new Event('input', { bubbles: true }));
            node.dispatchEvent(new Event('change', { bubbles: true }));
          };

          try {
            if (tag === 'select') {
              const sel = el as HTMLSelectElement;
              const want = String(value).toLowerCase();
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
              sel.value = opt.value;
              fire(sel);
              return { ok: true, detail: `selected "${opt.text.trim()}"` };
            }

            if (type === 'checkbox' || type === 'radio') {
              const box = el as HTMLInputElement;
              const want =
                typeof value === 'boolean' ? value : !/^(false|0|no|off|unchecked)$/i.test(String(value));
              if (box.checked !== want) box.click(); // click 才会走完整的 label/表单逻辑
              return { ok: true, detail: `${want ? 'checked' : 'unchecked'}` };
            }

            if (el.isContentEditable) {
              el.textContent = String(value);
              fire(el);
              return { ok: true, detail: 'set contenteditable text' };
            }

            el.focus();
            setNative(el, 'value', String(value));
            fire(el);
            return { ok: true, detail: `set value` };
          } catch (err) {
            return { ok: false, error: err instanceof Error ? err.message : String(err) };
          }
        },
      });

      const r = res?.result as { ok: boolean; error?: string; detail?: string } | undefined;
      if (!r) return { error: 'The page script returned nothing. Try read_page and retry.' };
      if (!r.ok) return { error: r.error ?? 'Could not set the value.' };

      return withContext(ctx, { output: `${args.ref}: ${r.detail}.` }, tabId);
    } catch (e) {
      return { error: msg(e) };
    } finally {
      void hideIndicator(tabId);
    }
  },
};

// ════════════════════════════ navigate ════════════════════════════

const navigateTool: Tool = {
  name: 'navigate',
  schema: navigateSchema,
  parse: parser(navigateInput, 'navigate'),
  async run(args: z.infer<typeof navigateInput>, ctx) {
    let tabId: number;
    try {
      tabId = await getEffectiveTabId(args.tabId, ctx.tabId);
    } catch (e) {
      return { error: msg(e) };
    }

    const isHistory = ['back', 'forward'].includes(args.url.toLowerCase());
    const target = isHistory ? args.url.toLowerCase() : normalizeUrl(args.url);

    if (!isHistory) {
      const bad = rejectUrl(target);
      if (bad) return { error: bad };
    }

    const blocked = await guard(
      ctx,
      tabId,
      PERMISSION.NAVIGATE,
      isHistory ? `Go ${target}` : `Navigate to ${target}`,
      { actionData: { url: target } },
    );
    if (blocked) return blocked;

    try {
      await showIndicator(tabId, 'Navigating');

      if (isHistory) {
        // chrome.tabs 没有 back/forward，用页面 history
        await chrome.scripting.executeScript({
          target: { tabId, frameIds: [0] },
          world: 'MAIN',
          args: [target],
          func: (dir: string) => (dir === 'back' ? history.back() : history.forward()),
        });
      } else {
        await chrome.tabs.update(tabId, { url: target });
      }

      const status = await waitForLoad(tabId);
      // 导航后旧的 ref 和截图坐标全部失效
      shot.clearViewportContext(tabId);

      const tab = await getTab(tabId);
      const note =
        status === 'timeout'
          ? ' The page is still loading; some content may be missing.'
          : '';

      void maybeCaptureGifFrame(tabId, `navigate:${tab.url ?? target}`);
      return withContext(
        ctx,
        {
          output:
            `Now on: ${tab.title ?? ''}\nURL: ${tab.url ?? target}${note}\n` +
            `All previous ref_N handles and screenshot coordinates are stale — call read_page or screenshot again.`,
        },
        tabId,
      );
    } catch (e) {
      return { error: `Navigation failed: ${msg(e)}` };
    } finally {
      void hideIndicator(tabId);
    }
  },
};

function normalizeUrl(raw: string): string {
  const u = raw.trim();
  if (/^[a-z][a-z0-9+.-]*:/i.test(u)) return u;
  return `https://${u}`;
}

/** 明确拒绝的协议。javascript: 是最危险的 —— 那是绕过 javascript_tool 权限的后门。 */
function rejectUrl(url: string): string | null {
  if (/^javascript:/i.test(url)) {
    return 'javascript: URLs are not allowed. Use the javascript_tool if you need to run code (it requires explicit user approval).';
  }
  if (/^(data|blob|filesystem):/i.test(url)) {
    return `${url.split(':')[0]}: URLs are not allowed for navigation.`;
  }
  if (/^file:/i.test(url)) {
    return 'file:// URLs are not allowed — the extension does not read local files.';
  }
  if (/^(chrome|chrome-extension|chrome-untrusted|devtools|edge|about|view-source):/i.test(url)) {
    return `Cannot navigate to ${url}: browser-internal pages are off limits.`;
  }
  return null;
}

// ════════════════════════════ tabs ════════════════════════════

const tabsContextTool: Tool = {
  name: 'tabs_context',
  schema: tabsContextSchema,
  parse: parser(emptyInput, 'tabs_context'),
  async run(_args: never, ctx) {
    try {
      const context = await buildTabContext(ctx.tabId);
      return { output: formatTabs(context), tabContext: context };
    } catch (e) {
      return { error: `Failed to query tabs: ${msg(e)}` };
    }
  },
};

const tabsCreateTool: Tool = {
  name: 'tabs_create',
  schema: tabsCreateSchema,
  parse: parser(emptyInput, 'tabs_create'),
  async run(_args: never, ctx) {
    try {
      const cur = await getTab(ctx.tabId);
      const tab = await chrome.tabs.create({
        windowId: cur.windowId,
        active: false, // 不抢用户焦点
      });
      if (tab.id === undefined) return { error: 'Failed to create a tab.' };

      // 当前 tab 已在用户分组 → 新 tab 跟进同组；否则收进 agent 自建组
      // （不把用户原 tab 拽进 Agent 组）
      if (cur.groupId !== undefined && cur.groupId !== -1) {
        try {
          await chrome.tabs.group({ tabIds: tab.id, groupId: cur.groupId });
        } catch {
          /* 分组失败无所谓 */
        }
      } else {
        await ensureAgentTabGrouped(tab.id);
      }

      openedByAgent.add(tab.id);
      return withContext(ctx, { output: `Created new tab. Tab ID: ${tab.id}` }, tab.id);
    } catch (e) {
      return { error: `Failed to create tab: ${msg(e)}` };
    }
  },
};

/** agent 自己开的 tab。只有这些允许被 tabs_close 关掉。 */
const openedByAgent = new Set<number>();

const tabsCloseTool: Tool = {
  name: 'tabs_close',
  schema: tabsCloseSchema,
  parse: parser(tabsCloseInput, 'tabs_close'),
  async run(args: z.infer<typeof tabsCloseInput>, ctx) {
    if (!openedByAgent.has(args.tabId)) {
      return {
        error:
          `Tab ${args.tabId} was not opened by you. Only close tabs you created with tabs_create — ` +
          `the user may have unsaved work in their own tabs. Ask the user if you need it closed.`,
      };
    }
    try {
      await cdp.detach(args.tabId).catch(() => {});
      await chrome.tabs.remove(args.tabId);
      openedByAgent.delete(args.tabId);
      return withContext(ctx, { output: `Closed tab ${args.tabId}.` });
    } catch (e) {
      return { error: `Failed to close tab: ${msg(e)}` };
    }
  },
};

// ════════════════════════ read_console_messages ════════════════════════

const readConsoleTool: Tool = {
  name: 'read_console_messages',
  schema: readConsoleSchema,
  parse: parser(readConsoleInput, 'read_console_messages'),
  async run(args: z.infer<typeof readConsoleInput>, ctx) {
    let tabId: number;
    try {
      tabId = await getEffectiveTabId(args.tabId, ctx.tabId);
    } catch (e) {
      return { error: msg(e) };
    }

    const blocked = await guard(ctx, tabId, PERMISSION.READ_CONSOLE_MESSAGES, 'Read console output');
    if (blocked) return blocked;

    const attachErr = await ensureAttached(tabId);
    if (attachErr) return attachErr;

    try {
      await obs.startConsoleCapture(tabId);

      const { entries, startedAt } = obs.readConsole(tabId, {
        levels: args.onlyErrors ? ['error', 'exception'] : undefined,
        limit: args.limit ?? 100,
      });

      let list = entries;
      if (args.pattern) {
        let re: RegExp;
        try {
          re = new RegExp(args.pattern, 'i');
        } catch {
          return { error: `Invalid regex pattern: ${args.pattern}` };
        }
        list = list.filter((e) => re.test(e.text));
      }

      if (args.clear) obs.stopConsoleCapture(tabId);

      if (list.length === 0) {
        const since = startedAt ? ` since capture started ${Math.round((Date.now() - startedAt) / 1000)}s ago` : '';
        return withContext(
          ctx,
          {
            output:
              `No console messages${args.pattern ? ` matching /${args.pattern}/` : ''}${since}. ` +
              `Console capture only sees output produced after the extension attached — reload the page to catch startup logs.`,
          },
          tabId,
        );
      }

      const lines = list.map((e) => {
        const loc = e.url ? ` (${e.url}${e.line ? `:${e.line}` : ''})` : '';
        return `[${e.level}] ${e.text}${loc}`;
      });

      return withContext(ctx, { output: `${list.length} message(s):\n${lines.join('\n')}` }, tabId);
    } catch (e) {
      return { error: msg(e) };
    }
  },
};

// ════════════════════════ read_network_requests ════════════════════════

const readNetworkTool: Tool = {
  name: 'read_network_requests',
  schema: readNetworkSchema,
  parse: parser(readNetworkInput, 'read_network_requests'),
  async run(args: z.infer<typeof readNetworkInput>, ctx) {
    let tabId: number;
    try {
      tabId = await getEffectiveTabId(args.tabId, ctx.tabId);
    } catch (e) {
      return { error: msg(e) };
    }

    const blocked = await guard(
      ctx,
      tabId,
      PERMISSION.READ_NETWORK_REQUESTS,
      args.includeBody ? 'Inspect network requests and response bodies' : 'Inspect network requests',
    );
    if (blocked) return blocked;

    const attachErr = await ensureAttached(tabId);
    if (attachErr) return attachErr;

    try {
      await obs.startNetworkCapture(tabId);

      const { entries, startedAt } = obs.readNetwork(tabId, {
        urlPattern: args.urlPattern,
        method: args.method,
        statusMin: args.statusMin,
        onlyFailed: args.onlyFailed,
        includeBody: args.includeBody,
        limit: args.limit ?? 100,
      });

      if (args.clear) await obs.stopNetworkCapture(tabId);

      if (entries.length === 0) {
        const since = startedAt
          ? ` since capture started ${Math.round((Date.now() - startedAt) / 1000)}s ago`
          : '';
        return withContext(
          ctx,
          {
            output:
              `No matching network requests${since}. Requests are only captured after the extension ` +
              `attaches — reload the page (navigate to the same URL) to capture the initial load.`,
          },
          tabId,
        );
      }

      const lines = entries.map((e) => {
        const status = e.errorText
          ? `FAILED ${e.errorText}`
          : e.status !== undefined
            ? `${e.status}${e.statusText ? ` ${e.statusText}` : ''}`
            : 'pending';
        const ms = e.finishedAt ? ` ${e.finishedAt - e.startedAt}ms` : '';
        return `${e.method} ${e.url}\n    → ${status}${ms}${e.mimeType ? ` ${e.mimeType}` : ''}`;
      });

      let output = `${entries.length} request(s):\n${lines.join('\n')}`;

      if (args.includeBody) {
        const bodies: string[] = [];
        // 只取前 5 个，body 很占 token
        for (const e of entries.slice(0, 5)) {
          try {
            const b = await obs.getResponseBody(tabId, e.requestId);
            if (b?.body) {
              bodies.push(`--- ${e.method} ${e.url}\n${truncate(b.body, 4000)}`);
            }
          } catch {
            /* body 常常拿不到（已被丢弃 / 太大），静默跳过 */
          }
        }
        if (bodies.length) {
          output += `\n\nResponse bodies (first ${bodies.length}):\n${bodies.join('\n\n')}`;
        } else {
          output += `\n\n(Response bodies were no longer available — Chrome discards them after a while. Re-run the request and read immediately.)`;
        }
      }

      return withContext(ctx, { output }, tabId);
    } catch (e) {
      return { error: msg(e) };
    }
  },
};

// ════════════════════════════ javascript_tool ════════════════════════════

const javascriptTool: Tool = {
  name: 'javascript_tool',
  schema: javascriptSchema,
  parse: parser(javascriptInput, 'javascript_tool'),
  gated: (s) => s.enableJavascriptTool,
  async run(args: z.infer<typeof javascriptInput>, ctx) {
    let tabId: number;
    try {
      tabId = await getEffectiveTabId(args.tabId, ctx.tabId);
    } catch (e) {
      return { error: msg(e) };
    }

    // 这个工具每次都问，而且把完整代码放进授权 UI —— 用户必须能看到要跑什么。
    const blocked = await guard(
      ctx,
      tabId,
      PERMISSION.EXECUTE_JAVASCRIPT,
      `Run JavaScript: ${truncate(args.text, 100)}`,
      { actionData: { code: args.text } },
    );
    if (blocked) return blocked;

    const attachErr = await ensureAttached(tabId);
    if (attachErr) return attachErr;

    try {
      await cdp.ensureDomain(tabId, 'Runtime');
      const res = await cdp.send<{
        result?: { type: string; value?: unknown; description?: string; subtype?: string };
        exceptionDetails?: { text: string; exception?: { description?: string } };
      }>(tabId, 'Runtime.evaluate', {
        expression: args.text,
        awaitPromise: true,
        returnByValue: true,
        userGesture: true,
        // REPL 语义：最后一个表达式的值就是结果，顶层 await 可用
        replMode: true,
        timeout: 10_000,
      });

      if (res.exceptionDetails) {
        const d = res.exceptionDetails;
        return {
          error: `JavaScript threw: ${d.exception?.description ?? d.text}`,
        };
      }

      const r = res.result;
      let out: string;
      if (!r || r.type === 'undefined') out = '(undefined)';
      else if (r.value !== undefined) {
        out = typeof r.value === 'string' ? r.value : JSON.stringify(r.value, null, 2);
      } else out = r.description ?? `[${r.type}]`;

      return withContext(ctx, { output: truncate(out, 20_000) }, tabId);
    } catch (e) {
      return { error: msg(e) };
    }
  },
};

// ════════════════════════════ resize_window ════════════════════════════

const resizeWindowTool: Tool = {
  name: 'resize_window',
  schema: resizeWindowSchema,
  parse: parser(resizeWindowInput, 'resize_window'),
  async run(args: z.infer<typeof resizeWindowInput>, ctx) {
    let tabId: number;
    try {
      tabId = await getEffectiveTabId(args.tabId, ctx.tabId);
    } catch (e) {
      return { error: msg(e) };
    }

    try {
      const tab = await getTab(tabId);
      await chrome.windows.update(tab.windowId, {
        width: Math.round(args.width),
        height: Math.round(args.height),
        state: 'normal', // 最大化状态下 width/height 会被忽略
      });
      await delay(220);
      shot.clearViewportContext(tabId); // 尺寸变了，旧坐标失效

      return withContext(
        ctx,
        {
          output:
            `Resized the window to ${args.width}x${args.height}. ` +
            `Previous screenshot coordinates are stale — take a new screenshot.`,
        },
        tabId,
      );
    } catch (e) {
      return { error: `Failed to resize: ${msg(e)}` };
    }
  },
};

// ════════════════════════════ update_plan ════════════════════════════

/**
 * update_plan 不"执行"任何东西 —— 它只是把计划交给用户批准。
 *
 * 批准的效果由 agent loop 处理（把 domains 加进 turn 级授权）。
 * 这样模型不需要在每个普通步骤上再问一次，但不可逆动作仍然会问。
 */
const updatePlanTool: Tool = {
  name: 'update_plan',
  schema: updatePlanSchema,
  parse: parser(updatePlanInput, 'update_plan'),
  async run(args: z.infer<typeof updatePlanInput>, ctx) {
    const decision = await ctx.requestPermission(PERMISSION.PLAN_APPROVAL, {
      actionLabel: 'Approve this plan',
      actionData: { plan: { domains: args.domains, approach: args.approach } },
    });

    if (!decision.allowed) {
      return {
        error:
          decision.reason ??
          'The user did not approve this plan. Ask what they would like to change instead of retrying.',
      };
    }

    return {
      output:
        `Plan approved for: ${args.domains.join(', ')}. ` +
        `Proceed with the approach you described. Irreversible actions (purchases, sending, ` +
        `deleting, publishing) still require separate confirmation.`,
    };
  },
};

/**
 * todowrite：纯 UI 状态，不需要权限。
 * 整表替换而不是 diff —— 模型更容易写对，UI 也不用处理合并冲突。
 */
const todoWriteTool: Tool = {
  name: 'todowrite',
  schema: todoWriteSchema,
  parse: parser(todoWriteInput, 'todowrite'),
  async run(args: z.infer<typeof todoWriteInput>) {
    setTodos(
      args.todos.map((t) => ({
        id: t.id,
        content: t.content,
        status: t.status,
      })),
    );
    const summary = args.todos
      .map((t) => `- [${t.status}] ${t.content}`)
      .join('\n');
    return {
      output: `Todo list updated (${args.todos.length} items):\n${summary}`,
    };
  },
};

// ════════════════════════════ 注册表 ════════════════════════════

const uploadImageTool = createUploadImageTool({ guard, withContext });
const fileUploadTool = createFileUploadTool({ guard, withContext });
const browserBatchTool = createBrowserBatchTool();
const gifCreatorTool = createGifCreatorTool({ guard });
const shortcutsListTool = createShortcutsListTool();
const shortcutsExecuteTool = createShortcutsExecuteTool();

const ALL: Tool[] = [
  computerTool,
  readPageTool,
  findTool,
  getPageTextTool,
  formInputTool,
  navigateTool,
  tabsContextTool,
  tabsCreateTool,
  tabsCloseTool,
  readConsoleTool,
  readNetworkTool,
  javascriptTool,
  resizeWindowTool,
  updatePlanTool,
  todoWriteTool,
  browserBatchTool,
  uploadImageTool,
  fileUploadTool,
  gifCreatorTool,
  shortcutsListTool,
  shortcutsExecuteTool,
];

const byName = new Map(ALL.map((t) => [t.name, t]));

export function getTool(name: string): Tool | undefined {
  return byName.get(name);
}

/** 当前设置下启用的工具。 */
export function enabledTools(): Tool[] {
  const s = peekSettings();
  return ALL.filter((t) => !t.gated || t.gated(s));
}

/** 发给模型的 tool 定义。 */
export function toolSchemas(): AnthropicToolSchema[] {
  return enabledTools().map((t) => t.schema);
}

/**
 * 执行一个工具调用。
 *
 * 这是 agent loop 唯一的入口。校验失败、工具不存在、执行抛错
 * 全部转成 `{ error }`，保证 loop 永远拿得到一个可回灌的结果。
 */
export async function runTool(
  name: string,
  rawInput: unknown,
  ctx: ToolContext,
): Promise<ToolResult> {
  const tool = byName.get(name);
  if (!tool) {
    return {
      error: `Unknown tool "${name}". Available: ${enabledTools().map((t) => t.name).join(', ')}`,
    };
  }

  if (tool.gated && !tool.gated(peekSettings())) {
    return {
      error: `The "${name}" tool is disabled in the extension settings. Tell the user they can enable it if they want this.`,
    };
  }

  const parsed = tool.parse(rawInput);
  if (!parsed.ok) return { error: parsed.error };

  if (ctx.signal.aborted) return { error: 'Stopped by the user.' };

  try {
    return await tool.run(parsed.value as never, ctx);
  } catch (e) {
    // 兜底：任何工具漏掉的异常都在这里变成模型可读的错误
    return { error: `${name} failed unexpectedly: ${msg(e)}` };
  }
}

/** 侧栏关闭 / turn 结束时清理每个 tab 的 CDP 状态。 */
export async function cleanupTools(): Promise<void> {
  for (const tabId of openedByAgent) {
    obs.disposeObservers(tabId);
  }
  await cdp.detachAll();
}

/** 清空对话时把 todo 板一起清掉（由 useSession.reset 调用）。 */
export { clearTodos } from '@/sidepanel/state/todos';
export { clearSessionMedia } from '@/media/catalog';

export { openedByAgent };
