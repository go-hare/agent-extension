/**
 * shortcuts_list / shortcuts_execute
 */

import type { z } from 'zod';
import type { ToolContext, ToolResult } from '@/shared/types';
import {
  emptyInput,
  formatZodError,
  shortcutsExecuteInput,
  shortcutsExecuteSchema,
  shortcutsListSchema,
} from './schemas';
import type { Tool } from './registry';
import { findShortcut, listShortcuts } from '@/shortcuts/store';

function parser<T extends z.ZodTypeAny>(schema: T, name: string) {
  return (raw: unknown): { ok: true; value: z.infer<T> } | { ok: false; error: string } => {
    const r = schema.safeParse(raw ?? {});
    if (r.success) return { ok: true, value: r.data };
    return { ok: false, error: formatZodError(r.error, name) };
  };
}

/** Sidepanel registers a runner so execute can start a new turn. */
type ShortcutRunner = (prompt: string, meta: { command: string; title: string }) => void;
let runner: ShortcutRunner | null = null;

export function setShortcutRunner(fn: ShortcutRunner | null): void {
  runner = fn;
}

export function createShortcutsListTool(): Tool {
  return {
    name: 'shortcuts_list',
    schema: shortcutsListSchema,
    parse: parser(emptyInput, 'shortcuts_list'),
    async run(_args: never, _ctx: ToolContext): Promise<ToolResult> {
      const items = await listShortcuts();
      const body = items.map((s) => ({
        id: s.id,
        command: s.command,
        title: s.title,
        description: s.description,
      }));
      return {
        output:
          body.length === 0
            ? 'No shortcuts saved. The user can add some in Options.'
            : JSON.stringify(body, null, 2),
      };
    },
  };
}

export function createShortcutsExecuteTool(): Tool {
  return {
    name: 'shortcuts_execute',
    schema: shortcutsExecuteSchema,
    parse: parser(shortcutsExecuteInput, 'shortcuts_execute'),
    async run(args: z.infer<typeof shortcutsExecuteInput>, _ctx: ToolContext): Promise<ToolResult> {
      const sc = await findShortcut({
        shortcutId: args.shortcutId,
        command: args.command,
      });
      if (!sc) {
        return {
          error:
            `Shortcut not found. Call shortcuts_list to see id/command values.` +
            (args.command ? ` (command=${args.command})` : '') +
            (args.shortcutId ? ` (id=${args.shortcutId})` : ''),
        };
      }
      if (!runner) {
        return {
          error:
            'Shortcut runner is not available (side panel not ready). Tell the user to keep the side panel open.',
        };
      }
      // Fire-and-forget a new turn with the shortcut prompt
      try {
        runner(sc.prompt, { command: sc.command, title: sc.title });
      } catch (e) {
        return { error: `Failed to start shortcut: ${e instanceof Error ? e.message : String(e)}` };
      }
      return {
        output: `Started shortcut "/${sc.command}" (${sc.title}). A new turn is running with its prompt.`,
      };
    },
  };
}
