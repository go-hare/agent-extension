/**
 * 截图 + 坐标换算。
 *
 * 这个模块是整个 agent 最容易出错的地方，原因是**三套坐标系**：
 *   1. CSS 像素（页面里 getBoundingClientRect 返回的）
 *   2. 设备像素（截图 PNG 的实际像素，= CSS × devicePixelRatio）
 *   3. 模型看到的坐标（我们喂给它的截图被缩放过，又是一套）
 *
 * 模型基于第 3 套给坐标，CDP Input 要的是第 1 套。中间的换算必须由我们做，
 * 而且要跟截图那一刻的状态严格对应 —— 页面滚动/缩放后旧坐标立即失效。
 */

import { send, ensureDomain } from './session';

/**
 * 一次请求最多能塞多少 base64 字符。
 *
 * Anthropic API 对单张图有 5MB 限制，base64 后膨胀 4/3，
 * 再留出 JSON 转义和其它 content block 的余量 → ~1.4M 字符。
 */
export const MAX_BASE64_CHARS = 1_398_100;

/** 质量降级阶梯。第一档就超限时逐级往下压，而不是直接给最低质量。 */
const QUALITY_LADDER = [0.75, 0.6, 0.45, 0.3, 0.2, 0.1];

/**
 * 模型看到的截图宽度上限。
 *
 * 超过这个宽度并不会让模型看得更清楚（视觉 token 有上限），
 * 反而浪费 token 且更容易触发尺寸限制。1024 是性价比拐点。
 */
const TARGET_MAX_WIDTH = 1024;
const TARGET_MAX_HEIGHT = 1536;

export interface ViewportContext {
  /** 页面 CSS 像素尺寸 */
  cssWidth: number;
  cssHeight: number;
  /** 截图输出的像素尺寸（模型看到的） */
  imageWidth: number;
  imageHeight: number;
  /** imageWidth / cssWidth。模型坐标 ÷ scale = CSS 坐标 */
  scale: number;
  devicePixelRatio: number;
  capturedAt: number;
}

/** 每个 tab 最近一次截图的上下文。坐标换算全靠它。 */
const contexts = new Map<number, ViewportContext>();

export function getViewportContext(tabId: number): ViewportContext | undefined {
  return contexts.get(tabId);
}

export function clearViewportContext(tabId: number): void {
  contexts.delete(tabId);
}

/**
 * 把模型给的坐标换算成 CSS 坐标。
 *
 * 没有截图上下文时原样返回 —— 说明模型是从 read_page 的 ref 拿的坐标，
 * 那些本来就是 CSS 坐标。
 */
export function toCssCoordinates(
  tabId: number,
  x: number,
  y: number,
): [number, number] {
  const ctx = contexts.get(tabId);
  if (!ctx || ctx.scale === 1) return [Math.round(x), Math.round(y)];
  return [Math.round(x / ctx.scale), Math.round(y / ctx.scale)];
}

interface LayoutMetrics {
  cssLayoutViewport: { clientWidth: number; clientHeight: number };
  cssVisualViewport: { clientWidth: number; clientHeight: number; scale?: number };
}

async function readViewport(tabId: number): Promise<{
  cssWidth: number;
  cssHeight: number;
  dpr: number;
}> {
  await ensureDomain(tabId, 'Page');
  const m = await send<LayoutMetrics>(tabId, 'Page.getLayoutMetrics');
  const cssWidth = m.cssVisualViewport?.clientWidth ?? m.cssLayoutViewport.clientWidth;
  const cssHeight = m.cssVisualViewport?.clientHeight ?? m.cssLayoutViewport.clientHeight;

  // devicePixelRatio 只能从页面里读
  await ensureDomain(tabId, 'Runtime');
  const dprRes = await send<{ result: { value: number } }>(tabId, 'Runtime.evaluate', {
    expression: 'window.devicePixelRatio',
    returnByValue: true,
  });
  const dpr = dprRes?.result?.value ?? 1;

  return { cssWidth, cssHeight, dpr };
}

export interface CaptureOptions {
  /** 只截某个区域（CSS 坐标） */
  clip?: { x: number; y: number; width: number; height: number };
  /** zoom action 用：把 clip 放大到填满视口 */
  fillViewport?: boolean;
  format?: 'png' | 'jpeg';
}

export interface CaptureResult {
  data: string;
  mediaType: 'image/png' | 'image/jpeg';
  width: number;
  height: number;
  /** 为了塞进限制做了多少压缩，用于日志 */
  quality?: number;
  truncatedNote?: string;
}

/**
 * Official-style full-tab capture via chrome.tabs.captureVisibleTab.
 * No debugger banner. Used as primary path for plain screenshots; CDP
 * Page.captureScreenshot remains for clip/zoom and as fallback.
 */
export async function captureVisible(
  tabId: number,
): Promise<CaptureResult | null> {
  try {
    const tab = await chrome.tabs.get(tabId);
    if (tab.windowId === undefined) return null;

    // Force activation like official kZ.captureVisibleTab (sidepanel steals focus).
    if (!tab.active) {
      await chrome.tabs.update(tabId, { active: true });
      await new Promise((r) => setTimeout(r, 200));
    }
    try {
      const win = await chrome.windows.get(tab.windowId);
      if (!win.focused) {
        await chrome.windows.update(tab.windowId, { focused: true });
        await new Promise((r) => setTimeout(r, 100));
      }
    } catch {
      /* focus best-effort */
    }

    const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, {
      format: 'jpeg',
      quality: 85,
    });
    const m = /^data:(image\/\w+);base64,(.+)$/.exec(dataUrl);
    if (!m) return null;

    // CSS viewport — coordinate space for CDP Input / phantom cursor.
    let cssWidth = 1280;
    let cssHeight = 720;
    let dpr = 1;
    try {
      const [{ result }] = await chrome.scripting.executeScript({
        target: { tabId },
        func: () => ({
          w: window.innerWidth,
          h: window.innerHeight,
          dpr: window.devicePixelRatio || 1,
        }),
      });
      if (result && typeof result === 'object') {
        const r = result as { w?: number; h?: number; dpr?: number };
        if (r.w) cssWidth = r.w;
        if (r.h) cssHeight = r.h;
        if (r.dpr) dpr = r.dpr;
      }
    } catch {
      /* restricted page — keep defaults */
    }

    // Always decode the real bitmap. captureVisibleTab returns *device* pixels
    // (CSS × DPR). Older code claimed imageWidth=cssWidth while shipping the
    // full-DPR JPEG → model/image-space coords and click markers were ~2× off
    // on Retina, and thumbs/lightbox markers drifted from the real click.
    const fitted = await fitCaptureToModel(dataUrl, cssWidth, cssHeight);
    if (!fitted) return null;

    contexts.set(tabId, {
      cssWidth,
      cssHeight,
      imageWidth: fitted.width,
      imageHeight: fitted.height,
      scale: fitted.width / cssWidth,
      devicePixelRatio: dpr,
      capturedAt: Date.now(),
    });

    return {
      data: fitted.data,
      mediaType: 'image/jpeg',
      width: fitted.width,
      height: fitted.height,
      quality: fitted.quality,
      truncatedNote: fitted.note,
    };
  } catch {
    return null;
  }
}

/**
 * Decode capture → resize to TARGET_MAX_* / API budget → raw base64.
 * Final width/height are the pixels the model (and our thumbs) actually see.
 */
async function fitCaptureToModel(
  dataUrl: string,
  cssWidth: number,
  cssHeight: number,
): Promise<{
  data: string;
  width: number;
  height: number;
  quality: number;
  note?: string;
} | null> {
  try {
    const blob = await (await fetch(dataUrl)).blob();
    const bitmap = await createImageBitmap(blob);
    const naturalW = bitmap.width;
    const naturalH = bitmap.height;

    // Cap by model target; never upscale past natural.
    let w = naturalW;
    let h = naturalH;
    const cap = Math.min(TARGET_MAX_WIDTH / w, TARGET_MAX_HEIGHT / h, 1);
    w = Math.max(1, Math.round(w * cap));
    h = Math.max(1, Math.round(h * cap));

    // Prefer keeping aspect locked to CSS viewport when natural is near CSS×DPR.
    // (Avoids 1px drift from capture chrome.)
    if (cssWidth > 0 && cssHeight > 0) {
      const aspect = cssWidth / cssHeight;
      const imgAspect = w / h;
      if (Math.abs(aspect - imgAspect) < 0.08) {
        // Keep w, recompute h from CSS aspect for stable scale.
        h = Math.max(1, Math.round(w / aspect));
      }
    }

    let q = 0.85;
    let note: string | undefined;
    for (let attempt = 0; attempt < 8; attempt++) {
      const canvas = new OffscreenCanvas(w, h);
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        bitmap.close();
        return null;
      }
      ctx.drawImage(bitmap, 0, 0, w, h);
      const out = await canvas.convertToBlob({ type: 'image/jpeg', quality: q });
      const buf = await out.arrayBuffer();
      const bytes = new Uint8Array(buf);
      let binary = '';
      for (let i = 0; i < bytes.length; i += 0x8000) {
        binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      }
      const b64 = btoa(binary);
      if (b64.length <= MAX_BASE64_CHARS) {
        bitmap.close();
        if (w < naturalW * 0.5 || h < naturalH * 0.5) {
          note =
            'Screenshot was heavily downscaled to fit size limits. ' +
            'Zoom into a smaller region if you need to read fine detail.';
        }
        return { data: b64, width: w, height: h, quality: q, note };
      }
      // Shrink further: quality ladder then pixel ladder.
      const nextQ = QUALITY_LADDER[Math.min(attempt, QUALITY_LADDER.length - 1)]!;
      if (nextQ < q - 0.01) {
        q = nextQ;
      } else {
        w = Math.max(1, Math.round(w * 0.75));
        h = Math.max(1, Math.round(h * 0.75));
        q = Math.min(q, 0.6);
      }
    }
    bitmap.close();
    return null;
  } catch {
    return null;
  }
}

/**
 * 截图。
 *
 * 流程：
 *  1. 无 clip 时优先 captureVisibleTab（官方路径，无调试横幅）
 *  2. 失败或需要 clip/zoom 时走 CDP Page.captureScreenshot
 *  3. 读视口尺寸和 DPR，算出 TARGET_MAX_* 缩放
 *  4. PNG 超限就切 JPEG，沿质量阶梯往下降
 */
export async function capture(
  tabId: number,
  opts: CaptureOptions = {},
): Promise<CaptureResult> {
  // Official primary path for full-frame shots — no debugger required.
  if (!opts.clip && !opts.fillViewport) {
    const visible = await captureVisible(tabId);
    if (visible) return visible;
  }

  await ensureDomain(tabId, 'Page');
  const { cssWidth, cssHeight, dpr } = await readViewport(tabId);

  const region = opts.clip ?? { x: 0, y: 0, width: cssWidth, height: cssHeight };

  // 目标缩放：把 region 缩到 TARGET_MAX_* 以内。
  // fillViewport（zoom）时反过来，允许放大到视口大小，但不超过 2x（再放大只是糊）。
  let scale: number;
  if (opts.fillViewport) {
    scale = Math.min(cssWidth / region.width, cssHeight / region.height, 2);
  } else {
    scale = Math.min(
      TARGET_MAX_WIDTH / region.width,
      TARGET_MAX_HEIGHT / region.height,
      1,
    );
  }

  const clip = { ...region, scale };

  // 第一发：PNG
  let format: 'png' | 'jpeg' = opts.format ?? 'png';
  let quality: number | undefined;
  let result = await send<{ data: string }>(tabId, 'Page.captureScreenshot', {
    format,
    clip,
    captureBeyondViewport: false,
    optimizeForSpeed: false,
  });

  let note: string | undefined;

  if (result.data.length > MAX_BASE64_CHARS) {
    format = 'jpeg';
    for (const q of QUALITY_LADDER) {
      quality = q;
      result = await send<{ data: string }>(tabId, 'Page.captureScreenshot', {
        format,
        quality: Math.round(q * 100),
        clip,
        captureBeyondViewport: false,
        optimizeForSpeed: true,
      });
      if (result.data.length <= MAX_BASE64_CHARS) break;
    }

    if (result.data.length > MAX_BASE64_CHARS) {
      // 最低质量还超，只能缩尺寸
      const shrink = Math.sqrt(MAX_BASE64_CHARS / result.data.length) * 0.9;
      clip.scale = scale * shrink;
      result = await send<{ data: string }>(tabId, 'Page.captureScreenshot', {
        format: 'jpeg',
        quality: 10,
        clip,
        captureBeyondViewport: false,
        optimizeForSpeed: true,
      });
      note =
        'Screenshot was heavily downscaled to fit size limits. ' +
        'Zoom into a smaller region if you need to read fine detail.';
    }
  }

  const imageWidth = Math.round(region.width * clip.scale);
  const imageHeight = Math.round(region.height * clip.scale);

  // 只有全屏截图才更新坐标上下文 —— zoom 出来的局部图坐标系不同，
  // 模型基于它给的坐标要单独处理（见 tools/computer.ts 的 zoom 分支）。
  if (!opts.clip) {
    contexts.set(tabId, {
      cssWidth,
      cssHeight,
      imageWidth,
      imageHeight,
      scale: clip.scale,
      devicePixelRatio: dpr,
      capturedAt: Date.now(),
    });
  }

  return {
    data: result.data,
    mediaType: format === 'png' ? 'image/png' : 'image/jpeg',
    width: imageWidth,
    height: imageHeight,
    quality,
    truncatedNote: note,
  };
}

/**
 * zoom：截取一块区域并放大到填满视口。
 *
 * 关键点：放大后模型看到的坐标系和真实页面**不再一致**。
 * 所以 zoom 之后必须在返回文本里明确告诉模型：
 * "这是放大图，要点击请先回到 screenshot 再给坐标"，否则它会拿放大图的坐标去点。
 */
export async function captureRegion(
  tabId: number,
  region: [number, number, number, number],
): Promise<CaptureResult & { regionCss: { x: number; y: number; width: number; height: number } }> {
  const [x0, y0, x1, y1] = region;
  const clip = {
    x: Math.min(x0, x1),
    y: Math.min(y0, y1),
    width: Math.abs(x1 - x0),
    height: Math.abs(y1 - y0),
  };

  if (clip.width < 4 || clip.height < 4) {
    throw new Error(
      `Zoom region is too small (${clip.width}x${clip.height}). ` +
        `Provide (x0, y0, x1, y1) spanning at least 4x4 pixels.`,
    );
  }

  const shot = await capture(tabId, { clip, fillViewport: true });
  return { ...shot, regionCss: clip };
}
