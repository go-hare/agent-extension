/**
 * Agent loop。
 *
 * 架构决定（和原版一致）：**loop 跑在侧栏页面里，不在 service worker 里**。
 *
 * 理由：
 *  - SW 会被 Chrome 随时杀掉（30 秒无事件）。一个跑了 5 分钟的 agent 任务
 *    在 SW 里活不下来，得靠 alarm 心跳硬撑，非常脆。
 *  - 侧栏只要开着就活着，而且工具需要的 chrome.debugger / chrome.tabs
 *    在扩展页面里同样可用。
 *  - 权限 UI 就在侧栏里，loop 直接 await 用户点击，不需要跨上下文传消息。
 *
 * 代价：关掉侧栏 = 任务终止。这是可以接受的 —— 用户看不见的自动化操作
 * 本来就不该继续跑。
 */

import type {
  ContentBlockParam,
  MessageParam,
  ToolUseBlock,
} from '@anthropic-ai/sdk/resources/messages';
import { describeApiError, streamMessage } from '@/api/client';
import { permissionManager, hostOf } from '@/permissions/manager';
import { buildSystemPrompt, planModeReminder } from '@/prompts/system';
import { peekSettings } from '@/storage/settings';
import { runTool, toolSchemas } from '@/tools/registry';
import { getTab } from '@/tools/tabs';
import {
  PERMISSION,
  type Permission,
  type PermissionDecision,
  type PermissionRequest,
  type PermissionScope,
  type ToolContext,
  type ToolResult,
} from '@/shared/types';

/**
 * 单轮上限。
 *
 * 不设上限的话，模型可能陷入 "screenshot → 看不清 → screenshot" 的循环，
 * 烧光用户的额度。50 轮足够完成绝大多数真实任务。
 */
const MAX_ITERATIONS = 50;

export type AgentEvent =
  | { type: 'text_delta'; text: string }
  | { type: 'thinking_delta'; text: string }
  | { type: 'tool_start'; id: string; name: string; input: unknown }
  | { type: 'tool_end'; id: string; name: string; result: ToolResult }
  | { type: 'permission_request'; request: PermissionRequest }
  | { type: 'permission_resolved'; toolUseId: string; granted: boolean }
  | { type: 'turn_start'; turnId: string }
  | { type: 'turn_end'; turnId: string; stopReason: string | null }
  | { type: 'error'; message: string; fatal: boolean }
  | { type: 'usage'; inputTokens: number; outputTokens: number };

export interface RunOptions {
  /** 完整对话历史（会被就地追加） */
  messages: MessageParam[];
  tabId: number;
  windowId: number;
  signal: AbortSignal;
  emit: (e: AgentEvent) => void;
}

let turnCounter = 0;

/**
 * 跑一轮完整对话（可能包含多次工具调用）。
 *
 * 返回时 `messages` 已经被更新成含 assistant 回复和 tool_result 的完整历史，
 * 调用方直接持久化即可。
 */
export async function runTurn(opts: RunOptions): Promise<void> {
  const { messages, signal, emit } = opts;
  const turnId = `turn_${Date.now()}_${++turnCounter}`;

  await permissionManager.startTurn(turnId);
  emit({ type: 'turn_start', turnId });

  let iterations = 0;

  try {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      if (signal.aborted) {
        emit({ type: 'error', message: 'Stopped by the user.', fatal: false });
        break;
      }

      const hitLimit = ++iterations > MAX_ITERATIONS;
      if (hitLimit) {
        // One final no-tools turn so the model can summarize, then we break.
        messages.push({
          role: 'user',
          content:
            `[System] You have reached the maximum of ${MAX_ITERATIONS} tool calls for this ` +
            `request. Stop calling tools and summarize what you accomplished and what is left.`,
        });
        emit({
          type: 'error',
          message: `Reached the ${MAX_ITERATIONS}-step limit for one request.`,
          fatal: false,
        });
      }

      const system = await buildSystem(opts.tabId);

      let stopReason: string | null = null;
      const assistantBlocks: ContentBlockParam[] = [];
      const toolUses: ToolUseBlock[] = [];

      try {
        const stream = streamMessage({
          system,
          messages,
          // After the limit, force a text-only wrap-up (no more tool_use loops).
          tools: hitLimit ? [] : toolSchemas(),
          signal,
        });

        stream.on('text', (delta: string) => emit({ type: 'text_delta', text: delta }));

        const final = await stream.finalMessage();
        stopReason = final.stop_reason;

        emit({
          type: 'usage',
          inputTokens: final.usage.input_tokens,
          outputTokens: final.usage.output_tokens,
        });

        for (const block of final.content) {
          if (block.type === 'text') {
            assistantBlocks.push({ type: 'text', text: block.text });
          } else if (block.type === 'tool_use') {
            assistantBlocks.push({
              type: 'tool_use',
              id: block.id,
              name: block.name,
              input: block.input,
            });
            toolUses.push(block);
          }
        }
      } catch (e) {
        if (signal.aborted) {
          emit({ type: 'error', message: 'Stopped.', fatal: false });
          break;
        }
        emit({ type: 'error', message: describeApiError(e), fatal: true });
        break;
      }

      // API 有时返回完全空的 content（额度/过滤等），不加进历史否则下一轮 400
      if (assistantBlocks.length === 0) {
        emit({
          type: 'error',
          message: 'The model returned an empty response. Try rephrasing your request.',
          fatal: true,
        });
        break;
      }

      messages.push({ role: 'assistant', content: assistantBlocks });

      // Limit turn: never execute more tools even if the model still emits them.
      if (hitLimit || toolUses.length === 0 || stopReason !== 'tool_use') {
        emit({ type: 'turn_end', turnId, stopReason });
        break;
      }

      // ── 执行工具 ──
      const results: ContentBlockParam[] = [];

      for (const use of toolUses) {
        if (signal.aborted) {
          // 已经在历史里的 tool_use 必须都有对应的 tool_result，
          // 否则下一次请求会被 API 拒绝（400 tool_use ids must have results）
          results.push(errorResult(use.id, 'Stopped by the user before this ran.'));
          continue;
        }

        emit({ type: 'tool_start', id: use.id, name: use.name, input: use.input });

        const ctx = makeToolContext(opts, turnId, use.id, emit);
        const result = await runTool(use.name, use.input, ctx);

        emit({ type: 'tool_end', id: use.id, name: use.name, result });
        results.push(toContentBlock(use.id, result));
      }

      messages.push({ role: 'user', content: results });
    }
  } finally {
    permissionManager.abortAll();
  }
}

/** 组装 system prompt，带上当前 tab 的上下文。 */
async function buildSystem(tabId: number): Promise<string> {
  const s = peekSettings();
  let currentUrl: string | undefined;
  let currentTitle: string | undefined;

  try {
    const tab = await getTab(tabId);
    currentUrl = tab.url;
    currentTitle = tab.title;
  } catch {
    /* tab 没了就不带上下文，模型会自己调 tabs_context */
  }

  const base = buildSystemPrompt({
    currentUrl,
    currentTitle,
    locale: s.locale,
    javascriptEnabled: s.enableJavascriptTool,
  });

  // Official follow_a_plan: inject a plan-first reminder when Ask before acting.
  // (Hard gate also lives in runTool — prompt alone is not enough.)
  if (s.permissionMode === 'ask') {
    return `${base}\n\n${planModeReminder()}`;
  }
  return base;
}

/**
 * 构造 ToolContext。
 *
 * `requestPermission` 是整个安全模型的枢纽：它先走 PermissionManager 的
 * 缓存判定，需要询问时才发事件给 UI，然后**真的挂起**等用户点击。
 */
function makeToolContext(
  opts: RunOptions,
  turnId: string,
  toolUseId: string,
  emit: (e: AgentEvent) => void,
): ToolContext {
  // requestPermission 用普通 method（非 arrow），以便 browser_batch 的
  // `{...ctx, batchMode:true}` 在子工具以 ctx.requestPermission() 调用时
  // this.batchMode 为 true，从而对 needsPrompt 走快速失败而不挂 UI。
  const ctx: ToolContext = {
    tabId: opts.tabId,
    windowId: opts.windowId,
    turnId,
    toolUseId,
    signal: opts.signal,
    messages: opts.messages,
    batchMode: false,

    async requestPermission(
      this: ToolContext,
      permission: Permission,
      detail,
    ): Promise<PermissionDecision> {
      const url = detail.url ?? '';
      const decision = permissionManager.check(url, permission, {
        actionLabel: detail.actionLabel,
      });

      if (decision.allowed) return decision;
      if (!decision.needsPrompt) return decision; // 明确拒绝，不问

      if (this.batchMode) {
        return {
          allowed: false,
          needsPrompt: true,
          reason:
            `Permission required for "${detail.actionLabel}"` +
            `${url ? ` on ${url}` : ''}. ` +
            `Call this tool standalone (not in browser_batch) so the user can approve, ` +
            `then batch the remaining steps.`,
        };
      }

      const host = hostOf(url);

      emit({
        type: 'permission_request',
        request: {
          type: 'permission_required',
          toolUseId,
          tool: permission,
          permission,
          url,
          host,
          actionLabel: detail.actionLabel,
          screenshot: detail.screenshot,
          actionData: detail.actionData,
        },
      });

      const answer = await permissionManager.waitFor(toolUseId, permission, host);
      emit({ type: 'permission_resolved', toolUseId, granted: answer.granted });

      if (!answer.granted) {
        // Plan rejection: official asks the model to revise the plan (re-call update_plan).
        if (permission === PERMISSION.PLAN_APPROVAL) {
          return {
            allowed: false,
            needsPrompt: false,
            reason:
              'Plan rejected by user. Ask the user how they would like to change the plan.',
          };
        }
        return {
          allowed: false,
          needsPrompt: false,
          reason:
            `The user declined "${detail.actionLabel}"${host ? ` on ${host}` : ''}. ` +
            `Do not retry this action or attempt it a different way. ` +
            `Explain what you were trying to do and ask how they want to proceed.`,
        };
      }

      return { allowed: true, needsPrompt: false };
    },
  };
  return ctx;
}

/** ToolResult → Anthropic tool_result content block。 */
function toContentBlock(toolUseId: string, result: ToolResult): ContentBlockParam {
  if (result.error) {
    return {
      type: 'tool_result',
      tool_use_id: toolUseId,
      is_error: true,
      content: [{ type: 'text', text: result.error }],
    };
  }

  const content: Array<
    | { type: 'text'; text: string }
    | {
        type: 'image';
        source: {
          type: 'base64';
          media_type: 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif';
          data: string;
        };
      }
  > = [];

  if (result.output) content.push({ type: 'text', text: result.output });

  for (const img of result.images ?? []) {
    // Anthropic image blocks: keep gif as jpeg/png path only if needed later;
    // pass through declared mediaType for catalog/export fidelity.
    const mediaType =
      img.mediaType === 'image/gif'
        ? 'image/gif'
        : img.mediaType === 'image/webp'
          ? 'image/webp'
          : img.mediaType === 'image/jpeg'
            ? 'image/jpeg'
            : 'image/png';
    content.push({
      type: 'image',
      source: { type: 'base64', media_type: mediaType, data: img.data },
    });
  }

  // tool_result 的 content 不能为空数组，API 会 400
  if (content.length === 0) content.push({ type: 'text', text: '(no output)' });

  return { type: 'tool_result', tool_use_id: toolUseId, content };
}

function errorResult(toolUseId: string, text: string): ContentBlockParam {
  return {
    type: 'tool_result',
    tool_use_id: toolUseId,
    is_error: true,
    content: [{ type: 'text', text }],
  };
}

/** 侧栏 UI 调这个来回答权限请求。 */
export async function answerPermission(
  toolUseId: string,
  granted: boolean,
  scope: PermissionScope = 'once',
): Promise<void> {
  await permissionManager.resolve(toolUseId, granted, scope);
}
