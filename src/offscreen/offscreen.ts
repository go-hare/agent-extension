/**
 * Offscreen document — Claude in Chrome 1.0.81 parity.
 *
 * Responsibilities (official offscreen.js):
 *  1. SW keepalive ping every 20s (MV3 idle kill bypass for long MCP sessions)
 *  2. OFFSCREEN_PLAY_SOUND via Web Audio API
 *  3. GENERATE_GIF — encode frames (our encoder, not gif.js)
 *  4. REVOKE_BLOB_URL
 */

import { encodeGif, uint8ToBase64 } from '@/gif/encode';

console.log('[Offscreen] Document loaded and ready');

// SW keepalive — offscreen docs aren't subject to MV3's 30s idle kill.
setInterval(() => {
  chrome.runtime.sendMessage({ type: 'SW_KEEPALIVE' }).catch(() => {
    /* SW restarting — self-heals via ensureOffscreenDocument */
  });
}, 20_000);

let audioContext: AudioContext | undefined;

function getAudioContext(): AudioContext {
  if (!audioContext) {
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    audioContext = new AudioCtx();
    console.log('[Offscreen] AudioContext created, state:', audioContext.state);
  }
  return audioContext;
}

async function playAudioWithWebAudioAPI(audioUrl: string, volume: number): Promise<void> {
  const ctx = getAudioContext();
  const response = await fetch(audioUrl);
  const arrayBuffer = await response.arrayBuffer();
  const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
  const source = ctx.createBufferSource();
  source.buffer = audioBuffer;
  const gainNode = ctx.createGain();
  gainNode.gain.value = volume;
  source.connect(gainNode);
  gainNode.connect(ctx.destination);
  if (ctx.state === 'suspended') {
    await ctx.resume();
  }
  source.start(0);
  await new Promise<void>((resolve, reject) => {
    source.onended = () => resolve();
    // AudioBufferSourceNode has no standard onerror; decode already throws.
    void reject;
  });
}

type GifFrameIn = {
  /** raw base64 jpeg/png without data: prefix, or full data URL */
  data?: string;
  jpegBase64?: string;
  base64?: string;
  label?: string;
  delay?: number;
};

type GenerateGifOptions = {
  delayCs?: number;
  maxSide?: number;
  quality?: number;
  showActionLabels?: boolean;
  showProgressBar?: boolean;
  showWatermark?: boolean;
};

function frameToJpegB64(f: GifFrameIn): string {
  const raw = f.jpegBase64 || f.base64 || f.data || '';
  const comma = raw.indexOf(',');
  if (raw.startsWith('data:') && comma >= 0) return raw.slice(comma + 1);
  return raw;
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || typeof message !== 'object') return false;
  const type = (message as { type?: string }).type;

  if (type === 'OFFSCREEN_PLAY_SOUND') {
    const volume = (message as { volume?: number }).volume ?? 0.5;
    const audioUrl = (message as { audioUrl?: string }).audioUrl;
    if (!audioUrl) {
      sendResponse({ success: false, error: 'Missing audioUrl' });
      return false;
    }
    playAudioWithWebAudioAPI(audioUrl, volume)
      .then(() => sendResponse({ success: true }))
      .catch((error: unknown) =>
        sendResponse({
          success: false,
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    return true;
  }

  if (type === 'REVOKE_BLOB_URL') {
    const blobUrl = (message as { blobUrl?: string }).blobUrl;
    if (blobUrl) {
      try {
        URL.revokeObjectURL(blobUrl);
      } catch {
        /* ignore */
      }
    }
    sendResponse({ success: true });
    return false;
  }

  if (type === 'GENERATE_GIF') {
    const frames = ((message as { frames?: GifFrameIn[] }).frames ?? []) as GifFrameIn[];
    const options = ((message as { options?: GenerateGifOptions }).options ??
      {}) as GenerateGifOptions;

    void (async () => {
      try {
        if (!frames.length) throw new Error('No frames to encode');
        const mapped = frames.map((f) => ({
          jpegBase64: frameToJpegB64(f),
          label: f.label,
        }));
        const encoded = await encodeGif(mapped, {
          delayCs: options.delayCs ?? 40,
          maxSide: options.maxSide ?? 480,
          quality: options.quality,
        });
        const b64 = uint8ToBase64(encoded.data);
        // Official returns blobUrl + size + dimensions for download path.
        const bytes = encoded.data;
        // Copy into a plain ArrayBuffer-backed Uint8Array for BlobPart typing.
        const copy = new Uint8Array(bytes.byteLength);
        copy.set(bytes);
        const blob = new Blob([copy], { type: 'image/gif' });
        const blobUrl = URL.createObjectURL(blob);
        sendResponse({
          success: true,
          result: {
            base64: b64,
            blobUrl,
            size: bytes.byteLength,
            width: encoded.width,
            height: encoded.height,
          },
        });
      } catch (error) {
        console.error('[Offscreen] Failed to generate GIF:', error);
        sendResponse({
          success: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    })();
    return true;
  }

  return false;
});
