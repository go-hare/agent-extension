/**
 * upload_image / file_upload — 把文件字节写进页面 file input 或 drop 目标。
 *
 * 不走原生文件选择器（agent 看不见也点不了）。用 MAIN-world DataTransfer + File。
 */

import type { z } from 'zod';
import { PERMISSION, type ToolContext, type ToolResult } from '@/shared/types';
import { resolveImage, getFile } from '@/media/catalog';
import * as shot from '@/cdp/screenshot';
import {
  fileUploadInput,
  fileUploadSchema,
  formatZodError,
  uploadImageInput,
  uploadImageSchema,
} from './schemas';
import { getEffectiveTabId, getTabUrl, delay } from './tabs';
import type { Tool } from './registry';

function parser<T extends z.ZodTypeAny>(schema: T, name: string) {
  return (raw: unknown): { ok: true; value: z.infer<T> } | { ok: false; error: string } => {
    const r = schema.safeParse(raw ?? {});
    if (r.success) return { ok: true, value: r.data };
    return { ok: false, error: formatZodError(r.error, name) };
  };
}

const MAX_FILE_BYTES = 8 * 1024 * 1024; // 8MB decoded approx via base64 length
const MAX_TOTAL_BYTES = 15 * 1024 * 1024;

function approxBytes(b64: string): number {
  return Math.floor((b64.length * 3) / 4);
}

type DeliverResult = { ok: true; detail: string } | { ok: false; error: string };

/**
 * 在页面 MAIN world 把 files 交给 ref 元素或坐标处的 drop 目标。
 * ref 解析使用与 a11y 相同的 __agentElementMap。
 */
async function deliverFiles(
  tabId: number,
  files: Array<{ data: string; name: string; mimeType: string }>,
  target: { ref?: string; coordinate?: [number, number] },
): Promise<DeliverResult> {
  try {
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId, frameIds: [0] },
      world: 'MAIN',
      args: [files, target.ref ?? null, target.coordinate ?? null],
      func: (
        filePayloads: Array<{ data: string; name: string; mimeType: string }>,
        refId: string | null,
        coordinate: [number, number] | null,
      ) => {
        function b64ToUint8(b64: string): Uint8Array {
          const bin = atob(b64);
          const arr = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
          return arr;
        }

        const dt = new DataTransfer();
        for (const f of filePayloads) {
          const bytes = b64ToUint8(f.data);
          // Copy into a plain ArrayBuffer-backed view for BlobPart typing across TS targets.
          const copy = new Uint8Array(bytes.byteLength);
          copy.set(bytes);
          const blob = new Blob([copy], { type: f.mimeType || 'application/octet-stream' });
          dt.items.add(new File([blob], f.name, { type: f.mimeType || 'application/octet-stream' }));
        }

        let el: Element | null = null;
        if (refId) {
          const map = (window as unknown as { __agentElementMap?: Record<string, WeakRef<Element>> })
            .__agentElementMap;
          const wr = map?.[refId];
          el = wr?.deref() ?? null;
          if (!el) {
            return {
              ok: false,
              error: `Element ${refId} no longer exists. Call read_page or find again.`,
            };
          }
        } else if (coordinate) {
          const [x, y] = coordinate;
          el = document.elementFromPoint(x, y);
          if (!el) {
            return { ok: false, error: `No element at coordinate [${x}, ${y}].` };
          }
          // 点到 iframe 时尝试深入（同域）
          if (el instanceof HTMLIFrameElement) {
            try {
              const rect = el.getBoundingClientRect();
              const doc = el.contentDocument;
              if (doc) {
                const inner = doc.elementFromPoint(x - rect.left, y - rect.top);
                if (inner) el = inner;
              }
            } catch {
              /* cross-origin */
            }
          }
        } else {
          return { ok: false, error: 'Missing ref or coordinate.' };
        }

        try {
          el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' as ScrollBehavior });
        } catch {
          el.scrollIntoView({ block: 'center', inline: 'center' });
        }

        const input =
          el instanceof HTMLInputElement && el.type === 'file'
            ? el
            : (el.querySelector?.('input[type="file"]') as HTMLInputElement | null) ??
              (el.closest?.('input[type="file"]') as HTMLInputElement | null);

        if (input && input.type === 'file') {
          try {
            input.files = dt.files;
          } catch (e) {
            return {
              ok: false,
              error: `Could not assign files to input: ${e instanceof Error ? e.message : String(e)}`,
            };
          }
          input.dispatchEvent(new Event('input', { bubbles: true }));
          input.dispatchEvent(new Event('change', { bubbles: true }));
          return {
            ok: true,
            detail: `Set ${dt.files.length} file(s) on <input type="file"> (${refId ?? 'coordinate'}).`,
          };
        }

        // Drag & drop path
        const rect = el.getBoundingClientRect();
        const cx = coordinate ? coordinate[0] : rect.left + rect.width / 2;
        const cy = coordinate ? coordinate[1] : rect.top + rect.height / 2;
        const common: DragEventInit = {
          bubbles: true,
          cancelable: true,
          clientX: cx,
          clientY: cy,
          dataTransfer: dt,
        };
        for (const type of ['dragenter', 'dragover', 'drop'] as const) {
          el.dispatchEvent(new DragEvent(type, common));
        }
        return {
          ok: true,
          detail: `Dispatched drop with ${dt.files.length} file(s) at (${Math.round(cx)}, ${Math.round(cy)}).`,
        };
      },
    });

    const r = result as DeliverResult | undefined;
    if (!r) return { ok: false, error: 'Page script returned nothing while delivering files.' };
    return r;
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

type GuardFn = (
  ctx: ToolContext,
  tabId: number,
  permission: typeof PERMISSION.UPLOAD_IMAGE,
  actionLabel: string,
  extra?: { actionData?: unknown },
) => Promise<ToolResult | null>;

type WithContextFn = (
  ctx: ToolContext,
  result: ToolResult,
  executedOnTabId?: number,
) => Promise<ToolResult>;

export function createUploadImageTool(deps: {
  guard: GuardFn;
  withContext: WithContextFn;
}): Tool {
  return {
    name: 'upload_image',
    schema: uploadImageSchema,
    parse: parser(uploadImageInput, 'upload_image'),
    async run(args: z.infer<typeof uploadImageInput>, ctx) {
      let tabId: number;
      try {
        tabId = await getEffectiveTabId(args.tabId, ctx.tabId);
      } catch (e) {
        return { error: e instanceof Error ? e.message : String(e) };
      }

      const blocked = await deps.guard(ctx, tabId, PERMISSION.UPLOAD_IMAGE, 'Upload an image to the page', {
        actionData: { imageId: args.imageId, ref: args.ref, coordinate: args.coordinate },
      });
      if (blocked) return blocked;

      const img = resolveImage(args.imageId, ctx.messages);
      if (!img) {
        return {
          error:
            `Image "${args.imageId}" not found. Take a computer screenshot first (the output includes imageId), ` +
            `or attach an image in the side panel.`,
        };
      }

      let coordinate = args.coordinate as [number, number] | undefined;
      if (coordinate) {
        coordinate = shot.toCssCoordinates(tabId, coordinate[0], coordinate[1]);
      }

      const filename = args.filename || img.filename || `${img.id}.png`;
      const delivered = await deliverFiles(
        tabId,
        [{ data: img.data, name: filename, mimeType: img.mediaType }],
        { ref: args.ref, coordinate },
      );
      if (!delivered.ok) return { error: delivered.error };

      await delay(120);
      return deps.withContext(ctx, { output: delivered.detail }, tabId);
    },
  };
}

export function createFileUploadTool(deps: {
  guard: GuardFn;
  withContext: WithContextFn;
}): Tool {
  return {
    name: 'file_upload',
    schema: fileUploadSchema,
    parse: parser(fileUploadInput, 'file_upload'),
    async run(args: z.infer<typeof fileUploadInput>, ctx) {
      let tabId: number;
      try {
        tabId = await getEffectiveTabId(args.tabId, ctx.tabId);
      } catch (e) {
        return { error: e instanceof Error ? e.message : String(e) };
      }

      const blocked = await deps.guard(ctx, tabId, PERMISSION.UPLOAD_IMAGE, 'Upload file(s) to the page', {
        actionData: { ref: args.ref, fileCount: (args.files?.length ?? 0) + (args.fileIds?.length ?? 0) },
      });
      if (blocked) return blocked;

      const files: Array<{ data: string; name: string; mimeType: string }> = [];

      for (const f of args.files ?? []) {
        const size = approxBytes(f.data);
        if (size > MAX_FILE_BYTES) {
          return {
            error: `File "${f.name}" is too large (~${Math.round(size / 1024 / 1024)}MB). Max per file is 8MB.`,
          };
        }
        files.push({
          data: f.data,
          name: f.name,
          mimeType: f.mimeType || 'application/octet-stream',
        });
      }

      for (const id of args.fileIds ?? []) {
        const entry = getFile(id);
        if (!entry) {
          return {
            error: `fileId "${id}" not found. Attach the file in the side panel first, or pass base64 in files[].`,
          };
        }
        const size = approxBytes(entry.data);
        if (size > MAX_FILE_BYTES) {
          return { error: `File "${entry.name}" is too large. Max per file is 8MB.` };
        }
        files.push({ data: entry.data, name: entry.name, mimeType: entry.mimeType });
      }

      const total = files.reduce((n, f) => n + approxBytes(f.data), 0);
      if (total > MAX_TOTAL_BYTES) {
        return { error: `Total upload size exceeds 15MB. Split into smaller uploads.` };
      }
      if (files.length === 0) {
        return { error: 'No files to upload.' };
      }

      const delivered = await deliverFiles(tabId, files, { ref: args.ref });
      if (!delivered.ok) return { error: delivered.error };

      await delay(120);
      return deps.withContext(
        ctx,
        {
          output: `${delivered.detail} Names: ${files.map((f) => f.name).join(', ')}.`,
        },
        tabId,
      );
    },
  };
}

// silence unused in case tree-shaking
void getTabUrl;
