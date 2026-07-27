/**
 * 进程内媒体目录（侧栏生命周期）。
 *
 * 截图 / 用户附件的 base64 只活在侧栏内存里，不写 chrome.storage：
 *  - 体积大，写 storage 会拖垮扩展
 *  - 关掉侧栏 = 任务结束，缓存一并清掉是合理语义
 *
 * 模型通过 imageId / fileId 引用；截图工具的 output 文案里会带上 id。
 */

export type MediaSource = 'screenshot' | 'user' | 'gif';

export interface CatalogImage {
  id: string;
  data: string; // raw base64, no data: prefix
  mediaType: 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif';
  width?: number;
  height?: number;
  tabId?: number;
  createdAt: number;
  source: MediaSource;
  filename?: string;
}

export interface CatalogFile {
  id: string;
  data: string; // raw base64
  name: string;
  mimeType: string;
  createdAt: number;
  source: 'user' | 'generated';
}

const images = new Map<string, CatalogImage>();
const files = new Map<string, CatalogFile>();
/** 每个 tab 最近的截图 id，方便 "用上一张图" 的兜底。 */
const lastShotByTab = new Map<number, string>();

let imgSeq = 0;
let fileSeq = 0;

const MAX_IMAGES = 40;
const MAX_FILES = 20;
const MAX_PER_TAB = 10;

function nextImageId(): string {
  return `img_${++imgSeq}`;
}

function nextFileId(): string {
  return `file_${++fileSeq}`;
}

function trimImages(): void {
  if (images.size <= MAX_IMAGES) return;
  const ordered = [...images.values()].sort((a, b) => a.createdAt - b.createdAt);
  const drop = ordered.slice(0, images.size - MAX_IMAGES);
  for (const item of drop) images.delete(item.id);
}

function trimFiles(): void {
  if (files.size <= MAX_FILES) return;
  const ordered = [...files.values()].sort((a, b) => a.createdAt - b.createdAt);
  const drop = ordered.slice(0, files.size - MAX_FILES);
  for (const item of drop) files.delete(item.id);
}

function trimTabShots(tabId: number): void {
  const forTab = [...images.values()]
    .filter((i) => i.tabId === tabId && i.source === 'screenshot')
    .sort((a, b) => a.createdAt - b.createdAt);
  while (forTab.length > MAX_PER_TAB) {
    const old = forTab.shift();
    if (old) images.delete(old.id);
  }
}

export function putScreenshot(opts: {
  data: string;
  mediaType: CatalogImage['mediaType'];
  width?: number;
  height?: number;
  tabId?: number;
}): CatalogImage {
  const id = nextImageId();
  const entry: CatalogImage = {
    id,
    data: opts.data,
    mediaType: opts.mediaType,
    width: opts.width,
    height: opts.height,
    tabId: opts.tabId,
    createdAt: Date.now(),
    source: 'screenshot',
    filename: `${id}.png`,
  };
  images.set(id, entry);
  if (opts.tabId !== undefined) {
    lastShotByTab.set(opts.tabId, id);
    trimTabShots(opts.tabId);
  }
  trimImages();
  return entry;
}

export function putUserImage(opts: {
  data: string;
  mediaType: CatalogImage['mediaType'];
  filename?: string;
  width?: number;
  height?: number;
}): CatalogImage {
  const id = nextImageId();
  const entry: CatalogImage = {
    id,
    data: opts.data,
    mediaType: opts.mediaType,
    width: opts.width,
    height: opts.height,
    createdAt: Date.now(),
    source: 'user',
    filename: opts.filename ?? `${id}.png`,
  };
  images.set(id, entry);
  trimImages();
  return entry;
}

export function putUserFile(opts: {
  data: string;
  name: string;
  mimeType?: string;
}): CatalogFile {
  const id = nextFileId();
  const entry: CatalogFile = {
    id,
    data: opts.data,
    name: opts.name,
    mimeType: opts.mimeType || 'application/octet-stream',
    createdAt: Date.now(),
    source: 'user',
  };
  files.set(id, entry);
  trimFiles();
  return entry;
}

export function putGeneratedFile(opts: {
  data: string;
  name: string;
  mimeType: string;
}): CatalogFile {
  const id = nextFileId();
  const entry: CatalogFile = {
    id,
    data: opts.data,
    name: opts.name,
    mimeType: opts.mimeType,
    createdAt: Date.now(),
    source: 'generated',
  };
  files.set(id, entry);
  trimFiles();
  return entry;
}

export function getImage(id: string): CatalogImage | undefined {
  return images.get(id);
}

export function getFile(id: string): CatalogFile | undefined {
  return files.get(id);
}

export function getLastScreenshot(tabId?: number): CatalogImage | undefined {
  if (tabId !== undefined) {
    const id = lastShotByTab.get(tabId);
    if (id) return images.get(id);
  }
  const shots = [...images.values()]
    .filter((i) => i.source === 'screenshot')
    .sort((a, b) => b.createdAt - a.createdAt);
  return shots[0];
}

/** 从对话历史里捞 imageId 旁边的 base64（catalog 未命中时的兜底）。 */
export function findImageInMessages(
  messages: unknown[] | undefined,
  imageId: string,
): CatalogImage | undefined {
  if (!messages?.length) return undefined;

  for (let mi = messages.length - 1; mi >= 0; mi--) {
    const msg = messages[mi] as { role?: string; content?: unknown };
    if (!msg || !Array.isArray(msg.content)) continue;
    const blocks = msg.content as Array<Record<string, unknown>>;

    for (let i = 0; i < blocks.length; i++) {
      const b = blocks[i];
      const text =
        b?.type === 'text' && typeof b.text === 'string'
          ? b.text
          : b?.type === 'tool_result' && typeof b.content === 'string'
            ? b.content
            : null;

      // tool_result content 可能是数组
      const toolParts: Array<Record<string, unknown>> = [];
      if (b?.type === 'tool_result') {
        if (Array.isArray(b.content)) toolParts.push(...(b.content as Array<Record<string, unknown>>));
        else if (typeof b.content === 'string' && b.content.includes(imageId)) {
          // 纯文本 tool_result：往后找不到 image，跳过
        }
      }

      const searchList =
        toolParts.length > 0
          ? toolParts
          : text && text.includes(imageId)
            ? blocks.slice(i)
            : null;

      if (!searchList) {
        if (typeof text === 'string' && text.includes(imageId)) {
          for (let j = i + 1; j < blocks.length; j++) {
            const n = blocks[j];
            if (n?.type === 'text') break;
            if (n?.type === 'image') {
              const src = n.source as { type?: string; data?: string; media_type?: string } | undefined;
              if (src?.data) {
                return {
                  id: imageId,
                  data: src.data,
                  mediaType: (src.media_type as CatalogImage['mediaType']) || 'image/png',
                  createdAt: Date.now(),
                  source: 'screenshot',
                };
              }
            }
          }
        }
        continue;
      }

      let hit = -1;
      for (let j = 0; j < searchList.length; j++) {
        const p = searchList[j];
        if (p?.type === 'text' && typeof p.text === 'string' && p.text.includes(imageId)) {
          hit = j;
          break;
        }
      }
      if (hit < 0) continue;
      for (let j = hit + 1; j < searchList.length; j++) {
        const p = searchList[j];
        if (p?.type === 'text') break;
        if (p?.type === 'image') {
          const src = p.source as { data?: string; media_type?: string } | undefined;
          if (src?.data) {
            return {
              id: imageId,
              data: src.data,
              mediaType: (src.media_type as CatalogImage['mediaType']) || 'image/png',
              createdAt: Date.now(),
              source: 'screenshot',
            };
          }
        }
      }
    }
  }
  return undefined;
}

export function resolveImage(
  imageId: string,
  messages?: unknown[],
): CatalogImage | undefined {
  return getImage(imageId) ?? findImageInMessages(messages, imageId);
}

export function clearSessionMedia(): void {
  images.clear();
  files.clear();
  lastShotByTab.clear();
}

export function listRecentImages(limit = 10): CatalogImage[] {
  return [...images.values()].sort((a, b) => b.createdAt - a.createdAt).slice(0, limit);
}
