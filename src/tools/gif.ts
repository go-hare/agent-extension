/**
 * gif_creator tool — record computer/navigate frames and export a downloadable GIF.
 */

import type { z } from 'zod';
import type { ToolContext, ToolResult } from '@/shared/types';
import { PERMISSION } from '@/shared/types';
import {
  gifCreatorInput,
  gifCreatorSchema,
  formatZodError,
} from './schemas';
import type { Tool } from './registry';
import {
  clearRecording,
  getSession,
  groupKey,
  listFrameSummary,
  pushFrame,
  startRecording,
  stopRecording,
} from '@/gif/recorder';
import { encodeGif, uint8ToBase64 } from '@/gif/encode';
import { putGeneratedFile, putScreenshot } from '@/media/catalog';
import * as shot from '@/cdp/screenshot';
import { getEffectiveTabId, getTab, delay } from './tabs';

function parser<T extends z.ZodTypeAny>(schema: T, name: string) {
  return (raw: unknown): { ok: true; value: z.infer<T> } | { ok: false; error: string } => {
    const r = schema.safeParse(raw ?? {});
    if (r.success) return { ok: true, value: r.data };
    return { ok: false, error: formatZodError(r.error, name) };
  };
}

async function resolveKey(tabId: number): Promise<string> {
  try {
    const t = await getTab(tabId);
    return groupKey({
      tabId,
      groupId: t.groupId !== undefined && t.groupId !== -1 ? t.groupId : undefined,
    });
  } catch {
    return groupKey({ tabId });
  }
}

type GuardFn = (
  ctx: ToolContext,
  tabId: number,
  permission: typeof PERMISSION.UPLOAD_IMAGE,
  actionLabel: string,
  extra?: { actionData?: unknown },
) => Promise<ToolResult | null>;

export function createGifCreatorTool(deps: { guard: GuardFn }): Tool {
  return {
    name: 'gif_creator',
    schema: gifCreatorSchema,
    parse: parser(gifCreatorInput, 'gif_creator'),
    async run(args: z.infer<typeof gifCreatorInput>, ctx) {
      let tabId: number;
      try {
        tabId = await getEffectiveTabId(args.tabId, ctx.tabId);
      } catch (e) {
        return { error: e instanceof Error ? e.message : String(e) };
      }

      const key = await resolveKey(tabId);

      switch (args.action) {
        case 'start_recording': {
          startRecording(key);
          // auto first frame
          try {
            const s = await shot.capture(tabId, { format: 'jpeg' }).catch(async () => shot.capture(tabId));
            const mediaType = s.mediaType.includes('jpeg') ? 'image/jpeg' : s.mediaType;
            // store jpeg-ish; if png, still ok for encoder path via createImageBitmap
            const b64 = s.data;
            pushFrame(key, {
              jpegBase64: b64,
              label: 'start',
              width: s.width,
              height: s.height,
            });
            putScreenshot({
              data: s.data,
              mediaType: mediaType as 'image/png' | 'image/jpeg',
              width: s.width,
              height: s.height,
              tabId,
            });
          } catch {
            /* first frame optional */
          }
          return {
            output:
              `Started GIF recording (${key}). ${listFrameSummary(key)}. ` +
              `Subsequent computer/navigate actions will add frames (max 50). ` +
              `Screenshot now for an explicit frame, then act, then stop_recording and export.`,
          };
        }
        case 'stop_recording': {
          try {
            const s = await shot.capture(tabId);
            pushFrame(key, {
              jpegBase64: s.data,
              label: 'stop',
              width: s.width,
              height: s.height,
            });
          } catch {
            /* optional */
          }
          stopRecording(key);
          return { output: `Stopped GIF recording. ${listFrameSummary(key)}` };
        }
        case 'clear': {
          clearRecording(key);
          return { output: `Cleared GIF session ${key}.` };
        }
        case 'export': {
          const sess = getSession(key);
          if (!sess || sess.frames.length === 0) {
            return {
              error:
                'No frames to export. start_recording, perform actions (or screenshot), stop_recording, then export.',
            };
          }
          if (sess.recording) stopRecording(key);

          let encoded: { data: Uint8Array; width: number; height: number };
          try {
            encoded = await encodeGif(
              sess.frames.map((f) => ({ jpegBase64: f.jpegBase64, label: f.label })),
              { delayCs: 40, maxSide: 480 },
            );
          } catch (e) {
            return { error: `GIF encode failed: ${e instanceof Error ? e.message : String(e)}` };
          }

          const b64 = uint8ToBase64(encoded.data);
          const filename =
            args.filename ||
            `recording-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.gif`;
          const fileEntry = putGeneratedFile({
            data: b64,
            name: filename,
            mimeType: 'image/gif',
          });

          const notes: string[] = [
            `Encoded GIF ${encoded.width}x${encoded.height}, ${sess.frames.length} frames, fileId=${fileEntry.id}.`,
          ];

          if (args.download) {
            try {
              const url = `data:image/gif;base64,${b64}`;
              await chrome.downloads.download({
                url,
                filename,
                saveAs: false,
              });
              notes.push(`Download started as ${filename}.`);
            } catch (e) {
              notes.push(
                `Download failed: ${e instanceof Error ? e.message : String(e)}. fileId still available.`,
              );
            }
          }

          if (args.coordinate) {
            const blocked = await deps.guard(
              ctx,
              tabId,
              PERMISSION.UPLOAD_IMAGE,
              'Drop exported GIF onto the page',
              { actionData: { filename, coordinate: args.coordinate } },
            );
            if (blocked) {
              return {
                error: blocked.error,
                output: notes.join(' '),
              };
            }
            try {
              const coord = shot.toCssCoordinates(tabId, args.coordinate[0], args.coordinate[1]);
              await chrome.scripting.executeScript({
                target: { tabId, frameIds: [0] },
                world: 'MAIN',
                args: [b64, filename, coord],
                func: (data: string, name: string, coordinate: [number, number]) => {
                  const bin = atob(data);
                  const arr = new Uint8Array(bin.length);
                  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
                  const blob = new Blob([arr], { type: 'image/gif' });
                  const file = new File([blob], name, { type: 'image/gif' });
                  const dt = new DataTransfer();
                  dt.items.add(file);
                  const el = document.elementFromPoint(coordinate[0], coordinate[1]);
                  if (!el) return { ok: false, error: 'No element at coordinate' };
                  const common: DragEventInit = {
                    bubbles: true,
                    cancelable: true,
                    clientX: coordinate[0],
                    clientY: coordinate[1],
                    dataTransfer: dt,
                  };
                  for (const type of ['dragenter', 'dragover', 'drop'] as const) {
                    el.dispatchEvent(new DragEvent(type, common));
                  }
                  return { ok: true };
                },
              });
              notes.push(`Dropped GIF at (${args.coordinate[0]}, ${args.coordinate[1]}).`);
            } catch (e) {
              notes.push(`Drop failed: ${e instanceof Error ? e.message : String(e)}`);
            }
          }

          await delay(50);
          return {
            output: notes.join(' '),
            images: [{ mediaType: 'image/gif' as const, data: b64 }],
          };
        }
        default:
          return { error: `Unknown gif_creator action.` };
      }
    },
  };
}

/** Hook from computer/navigate success paths. */
export async function maybeCaptureGifFrame(
  tabId: number,
  label: string,
): Promise<void> {
  try {
    const t = await getTab(tabId);
    const key = groupKey({
      tabId,
      groupId: t.groupId !== undefined && t.groupId !== -1 ? t.groupId : undefined,
    });
    const sess = getSession(key);
    if (!sess?.recording) {
      // try tab-only key
      const alt = getSession(`tab:${tabId}`);
      if (!alt?.recording) return;
      const s = await shot.capture(tabId);
      pushFrame(`tab:${tabId}`, {
        jpegBase64: s.data,
        label,
        width: s.width,
        height: s.height,
      });
      return;
    }
    const s = await shot.capture(tabId);
    pushFrame(key, {
      jpegBase64: s.data,
      label,
      width: s.width,
      height: s.height,
    });
  } catch {
    /* non-fatal */
  }
}
