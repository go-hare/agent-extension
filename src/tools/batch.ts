/**
 * browser_batch — 一次 round-trip 顺序执行多个子工具。
 *
 * 对齐官方 1.0.81 语义：
 *  - 顺序执行，遇错即停
 *  - 禁止嵌套 browser_batch
 *  - 需要用户点授权时不挂起，直接失败并让模型 standalone 再调
 *  - 坐标基准 = batch 调用前的截图
 */

import type { z } from 'zod';
import type { ToolResult, ToolContext } from '@/shared/types';
import {
  browserBatchInput,
  browserBatchSchema,
  formatZodError,
} from './schemas';
import { runTool, type Tool as RegTool } from './registry';
import { delay } from './tabs';

// 避免循环类型：registry 会 import createBrowserBatchTool
// runTool 在 registry 定义，这里动态依赖没问题（运行时已初始化）

function parser<T extends z.ZodTypeAny>(schema: T, name: string) {
  return (raw: unknown): { ok: true; value: z.infer<T> } | { ok: false; error: string } => {
    const r = schema.safeParse(raw ?? {});
    if (r.success) return { ok: true, value: r.data };
    return { ok: false, error: formatZodError(r.error, name) };
  };
}

const MAX_BATCH_IMAGES = 5;

function stepLabel(name: string, input: Record<string, unknown>): string {
  const action = input?.action;
  if (typeof action === 'string' && action) return `${name}:${action}`;
  return name;
}

async function waitTabSettled(tabId: number | undefined, ms = 3000): Promise<void> {
  if (tabId === undefined) {
    await delay(120);
    return;
  }
  const start = Date.now();
  while (Date.now() - start < ms) {
    try {
      const tab = await chrome.tabs.get(tabId);
      if (tab.status === 'complete') return;
    } catch {
      return;
    }
    await delay(150);
  }
}

export function createBrowserBatchTool(): RegTool {
  return {
    name: 'browser_batch',
    schema: browserBatchSchema,
    parse: parser(browserBatchInput, 'browser_batch'),
    gated: (s) => s.enableBrowserBatch,
    async run(args: z.infer<typeof browserBatchInput>, ctx: ToolContext): Promise<ToolResult> {
      if (ctx.batchMode) {
        return { error: 'browser_batch cannot be nested.' };
      }

      const lines: string[] = [];
      const images: NonNullable<ToolResult['images']> = [];
      let lastTabId: number | undefined = ctx.tabId;
      const total = args.actions.length;

      const batchCtx: ToolContext = {
        ...ctx,
        batchMode: true,
        // 子工具若需要 prompt，requestPermission 会走 batch 快速失败路径
      };

      for (let i = 0; i < total; i++) {
        if (ctx.signal.aborted) {
          return {
            error: `Batch cancelled by the user (${i} completed, ${total - i} remaining).`,
            output: lines.length ? lines.join('\n') : undefined,
            images: images.length ? images : undefined,
          };
        }

        const step = args.actions[i];
        const label = stepLabel(step.name, step.input as Record<string, unknown>);

        if (step.name === 'browser_batch') {
          return {
            error:
              `actions[${i}] (${label}) failed: browser_batch cannot be nested ` +
              `(${i} completed, ${total - i} remaining).`,
            output: lines.length ? lines.join('\n') : undefined,
            images: images.length ? images : undefined,
          };
        }

        const result = await runTool(step.name, step.input, batchCtx);

        // Defensive: bare permissionRequired must never count as OK under batch
        // (MCP guard should already convert to error when batchMode).
        if (result.permissionRequired && !result.error) {
          const pr = result.permissionRequired;
          const urlHint = pr.url ? `: ${pr.url}` : '';
          result.error =
            `permission_required${urlHint} — call "${step.name}" standalone ` +
            `(not in browser_batch) so the user is prompted.`;
        }

        if (result.error) {
          const needsPerm =
            /did not grant permission|needs permission|declined|standalone|permission_required/i.test(
              result.error,
            );
          const hint = needsPerm
            ? ` Call "${step.name}" standalone (not in browser_batch) so the user can approve, then batch the rest.`
            : '';
          lines.push(`[${i + 1}/${total}] ${label} FAILED: ${result.error}`);
          return {
            error:
              `actions[${i}] (${label}) failed: ${result.error} ` +
              `(${i} completed, ${total - i} remaining).${hint}`,
            output: lines.join('\n'),
            images: images.length ? images.slice(-MAX_BATCH_IMAGES) : undefined,
          };
        }

        const out = (result.output ?? '(ok)').slice(0, 500);
        lines.push(`[${i + 1}/${total}] ${label} OK: ${out}`);
        if (result.images?.length) {
          for (const img of result.images) {
            images.push(img);
          }
        }
        if (result.tabContext?.executedOnTabId !== undefined) {
          lastTabId = result.tabContext.executedOnTabId;
        } else if (result.tabContext?.currentTabId !== undefined) {
          lastTabId = result.tabContext.currentTabId;
        }

        if (i < total - 1) {
          await waitTabSettled(lastTabId);
        }
      }

      const trimmed = images.slice(-MAX_BATCH_IMAGES);
      const note =
        images.length > MAX_BATCH_IMAGES
          ? `\n(Returned last ${MAX_BATCH_IMAGES} of ${images.length} images from this batch.)`
          : '';

      return {
        output:
          `Batch completed ${total}/${total} action(s).\n` +
          `Coordinates in this batch referred to the pre-batch screenshot.\n` +
          lines.join('\n') +
          note,
        images: trimmed.length ? trimmed : undefined,
      };
    },
  };
}
