/**
 * Ensure the official-style offscreen document exists (SW helper).
 * Reasons match 1.0.81: AUDIO_PLAYBACK + BLOBS (GIF + sound + keepalive).
 */

const OFFSCREEN_PATH = 'src/offscreen/index.html';

let creating: Promise<void> | undefined;

export async function ensureOffscreenDocument(): Promise<void> {
  if (!chrome.offscreen) return;

  creating ??= (async () => {
    try {
      const has = await chrome.offscreen.hasDocument?.();
      if (has) return;
    } catch {
      /* hasDocument may throw on older builds — try create anyway */
    }
    try {
      await chrome.offscreen.createDocument({
        url: OFFSCREEN_PATH,
        reasons: [
          chrome.offscreen.Reason.AUDIO_PLAYBACK,
          chrome.offscreen.Reason.BLOBS,
        ],
        justification:
          'Keep service worker alive, play notification sounds, generate GIFs',
      });
    } catch (e) {
      // Already exists race
      const msg = e instanceof Error ? e.message : String(e);
      if (!/already exists|only one offscreen/i.test(msg)) {
        console.warn('[Offscreen] createDocument failed:', msg);
      }
    }
  })().finally(() => {
    creating = undefined;
  });

  await creating;
}

export function offscreenPageUrl(): string {
  return chrome.runtime.getURL(OFFSCREEN_PATH);
}
