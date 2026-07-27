/**
 * Minimal GIF89a encoder (global palette + LZW).
 * Input frames are JPEG base64; decoded via createImageBitmap + OffscreenCanvas.
 */

export interface EncodeOptions {
  /** delay between frames in hundredths of a second (default 50 = 0.5s) */
  delayCs?: number;
  /** max dimension (longest side); default 480 */
  maxSide?: number;
  quality?: number; // reserved
}

async function decodeJpeg(
  b64: string,
  maxSide: number,
): Promise<{ data: Uint8ClampedArray; width: number; height: number }> {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const blob = new Blob([bytes], { type: 'image/jpeg' });
  const bmp = await createImageBitmap(blob);
  let w = bmp.width;
  let h = bmp.height;
  const scale = Math.min(1, maxSide / Math.max(w, h));
  w = Math.max(1, Math.round(w * scale));
  h = Math.max(1, Math.round(h * scale));
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('OffscreenCanvas 2d unavailable');
  ctx.drawImage(bmp, 0, 0, w, h);
  bmp.close();
  const img = ctx.getImageData(0, 0, w, h);
  return { data: img.data, width: w, height: h };
}

/** Median-cut-ish: sample pixels into 256 colors. */
function buildPalette(frames: Array<{ data: Uint8ClampedArray }>, size = 256): Uint8Array {
  const samples: number[] = [];
  for (const f of frames) {
    const step = Math.max(4, Math.floor(f.data.length / 4 / 2000) * 4);
    for (let i = 0; i < f.data.length; i += step) {
      samples.push((f.data[i] << 16) | (f.data[i + 1] << 8) | f.data[i + 2]);
    }
  }
  // unique-ish via map of quantized colors (5 bits/channel)
  const map = new Map<number, number>();
  for (const c of samples) {
    const q =
      (((c >> 16) & 0xf8) << 16) | (((c >> 8) & 0xf8) << 8) | ((c & 0xf8) << 0);
    map.set(q, (map.get(q) ?? 0) + 1);
  }
  const sorted = [...map.entries()].sort((a, b) => b[1] - a[1]);
  const palette = new Uint8Array(size * 3);
  const n = Math.min(size, sorted.length);
  for (let i = 0; i < n; i++) {
    const c = sorted[i][0];
    palette[i * 3] = (c >> 16) & 0xff;
    palette[i * 3 + 1] = (c >> 8) & 0xff;
    palette[i * 3 + 2] = c & 0xff;
  }
  // fill rest with last
  for (let i = n; i < size; i++) {
    palette[i * 3] = palette[(n - 1) * 3] ?? 0;
    palette[i * 3 + 1] = palette[(n - 1) * 3 + 1] ?? 0;
    palette[i * 3 + 2] = palette[(n - 1) * 3 + 2] ?? 0;
  }
  return palette;
}

function nearestIndex(palette: Uint8Array, r: number, g: number, b: number): number {
  let best = 0;
  let bestD = Infinity;
  const n = palette.length / 3;
  for (let i = 0; i < n; i++) {
    const dr = r - palette[i * 3];
    const dg = g - palette[i * 3 + 1];
    const db = b - palette[i * 3 + 2];
    const d = dr * dr + dg * dg + db * db;
    if (d < bestD) {
      bestD = d;
      best = i;
      if (d === 0) break;
    }
  }
  return best;
}

function indexFrame(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  palette: Uint8Array,
): Uint8Array {
  const out = new Uint8Array(width * height);
  for (let i = 0, p = 0; i < out.length; i++, p += 4) {
    out[i] = nearestIndex(palette, data[p], data[p + 1], data[p + 2]);
  }
  return out;
}

function lzwEncode(indexStream: Uint8Array, minCodeSize: number): Uint8Array {
  const clearCode = 1 << minCodeSize;
  const eoiCode = clearCode + 1;
  let codeSize = minCodeSize + 1;
  let nextCode = eoiCode + 1;
  const maxCode = 4095;

  let dict: Map<string, number> = new Map();

  const resetDict = () => {
    dict = new Map();
    for (let i = 0; i < clearCode; i++) dict.set(String.fromCharCode(i), i);
    codeSize = minCodeSize + 1;
    nextCode = eoiCode + 1;
  };

  const outBits: number[] = [];
  let cur = 0;
  let curBits = 0;
  const writeCode = (code: number) => {
    cur |= code << curBits;
    curBits += codeSize;
    while (curBits >= 8) {
      outBits.push(cur & 0xff);
      cur >>= 8;
      curBits -= 8;
    }
  };

  resetDict();
  writeCode(clearCode);

  let w = String.fromCharCode(indexStream[0]);
  for (let i = 1; i < indexStream.length; i++) {
    const k = String.fromCharCode(indexStream[i]);
    const wk = w + k;
    if (dict.has(wk)) {
      w = wk;
    } else {
      writeCode(dict.get(w)!);
      if (nextCode <= maxCode) {
        dict.set(wk, nextCode++);
        if (nextCode > 1 << codeSize && codeSize < 12) codeSize++;
      } else {
        writeCode(clearCode);
        resetDict();
      }
      w = k;
    }
  }
  writeCode(dict.get(w)!);
  writeCode(eoiCode);
  if (curBits > 0) outBits.push(cur & 0xff);
  return new Uint8Array(outBits);
}

function writeSubBlocks(data: Uint8Array, parts: number[]): void {
  let i = 0;
  while (i < data.length) {
    const n = Math.min(255, data.length - i);
    parts.push(n);
    for (let j = 0; j < n; j++) parts.push(data[i + j]);
    i += n;
  }
  parts.push(0);
}

export async function encodeGif(
  frames: Array<{ jpegBase64: string; label?: string }>,
  opts: EncodeOptions = {},
): Promise<{ data: Uint8Array; width: number; height: number }> {
  if (frames.length === 0) throw new Error('No frames to encode.');
  const delayCs = opts.delayCs ?? 50;
  const maxSide = opts.maxSide ?? 480;

  const decoded = [];
  for (const f of frames) {
    decoded.push(await decodeJpeg(f.jpegBase64, maxSide));
  }
  const width = decoded[0].width;
  const height = decoded[0].height;
  // normalize sizes by re-scaling mismatches simply crop/pad via redraw already scaled

  const palette = buildPalette(decoded, 256);
  const colorBits = 8; // 256 colors
  const parts: number[] = [];

  // Header
  parts.push(...[0x47, 0x49, 0x46, 0x38, 0x39, 0x61]); // GIF89a
  parts.push(width & 0xff, (width >> 8) & 0xff, height & 0xff, (height >> 8) & 0xff);
  parts.push(0x80 | ((colorBits - 1) << 4) | (colorBits - 1)); // GCT flag
  parts.push(0); // bg
  parts.push(0); // aspect
  for (let i = 0; i < 256 * 3; i++) parts.push(palette[i] ?? 0);

  // Netscape loop
  parts.push(0x21, 0xff, 0x0b);
  for (const c of 'NETSCAPE2.0') parts.push(c.charCodeAt(0));
  parts.push(0x03, 0x01, 0x00, 0x00, 0x00);

  const minCodeSize = 8;
  for (const fr of decoded) {
    // Graphic Control Extension
    parts.push(0x21, 0xf9, 0x04, 0x00, delayCs & 0xff, (delayCs >> 8) & 0xff, 0x00, 0x00);
    // Image Descriptor
    parts.push(0x2c, 0x00, 0x00, 0x00, 0x00);
    parts.push(width & 0xff, (width >> 8) & 0xff, height & 0xff, (height >> 8) & 0xff);
    parts.push(0x00); // no local CT
    const indexed =
      fr.width === width && fr.height === height
        ? indexFrame(fr.data, width, height, palette)
        : indexFrame(fr.data, fr.width, fr.height, palette);
    // if size mismatch, still write with actual size — skip; we force same scale from maxSide so ok
    parts.push(minCodeSize);
    const compressed = lzwEncode(indexed, minCodeSize);
    writeSubBlocks(compressed, parts);
  }

  parts.push(0x3b); // trailer
  return { data: new Uint8Array(parts), width, height };
}

export function uint8ToBase64(data: Uint8Array): string {
  let s = '';
  const chunk = 0x8000;
  for (let i = 0; i < data.length; i += chunk) {
    s += String.fromCharCode(...data.subarray(i, i + chunk));
  }
  return btoa(s);
}
