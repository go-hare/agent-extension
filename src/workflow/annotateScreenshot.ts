/**
 * Official Teach Claude click marker:
 * blue translucent circle at click point on a full-page JPEG/PNG.
 */

export async function annotateClick(
  base64: string,
  click: { x: number; y: number },
  viewport: { width: number; height: number },
  mediaType: 'image/jpeg' | 'image/png' = 'image/jpeg',
): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      try {
        const scaleX = img.width / viewport.width;
        const scaleY = img.height / viewport.height;
        const cx = click.x * scaleX;
        const cy = click.y * scaleY;

        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Failed to get canvas context'));
          return;
        }
        ctx.drawImage(img, 0, 0);

        const radius = Math.max(40, Math.min(120, 0.05 * Math.min(img.width, img.height)));
        ctx.beginPath();
        ctx.arc(cx, cy, radius, 0, 2 * Math.PI);
        ctx.fillStyle = 'rgba(44, 132, 219, 0.3)';
        ctx.fill();
        ctx.strokeStyle = 'rgba(44, 132, 219, 1)';
        ctx.lineWidth = 2;
        ctx.stroke();

        const dataUrl = canvas.toDataURL('image/jpeg', 0.9);
        const b64 = dataUrl.split(',')[1] || '';
        resolve(b64);
      } catch (e) {
        reject(e);
      }
    };
    img.onerror = () => reject(new Error('Failed to load screenshot image'));
    img.src = `data:${mediaType};base64,${base64}`;
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export type CaptureTabOpts = {
  /** Prefer this tab (activates it if needed — official forceTabActivation). */
  tabId?: number;
  windowId?: number;
  /** When true (default), activate non-active tab + focus its window before capture. */
  forceTabActivation?: boolean;
};

/**
 * Capture the visible tab as JPEG base64 (no data: prefix).
 * Prefer captureVisibleTab so we don't attach the debugger banner.
 *
 * Official 1.0.81 path: if the target tab is not active, tabs.update({active:true})
 * + short delay; if the window is unfocused (side panel stole focus), windows.update
 * focused + delay — then captureVisibleTab.
 */
export async function captureTabJpeg(
  windowIdOrOpts?: number | CaptureTabOpts,
): Promise<string | null> {
  try {
    const opts: CaptureTabOpts =
      typeof windowIdOrOpts === 'number'
        ? { windowId: windowIdOrOpts, forceTabActivation: true }
        : windowIdOrOpts ?? { forceTabActivation: true };

    const force = opts.forceTabActivation !== false;
    let windowId = opts.windowId;
    let tabId = opts.tabId;

    if (tabId !== undefined) {
      try {
        const tab = await chrome.tabs.get(tabId);
        windowId = tab.windowId;
        if (force && !tab.active) {
          await chrome.tabs.update(tabId, { active: true });
          await sleep(200);
        }
      } catch {
        /* tab may have closed */
      }
    }

    if (windowId === undefined && tabId === undefined) {
      const [active] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      if (active?.windowId !== undefined) {
        windowId = active.windowId;
        tabId = active.id;
      }
    }

    if (windowId === undefined) return null;

    if (force) {
      try {
        const win = await chrome.windows.get(windowId);
        if (!win.focused) {
          await chrome.windows.update(windowId, { focused: true });
          await sleep(100);
        }
      } catch {
        /* ignore focus failures */
      }
    }

    const dataUrl = await chrome.tabs.captureVisibleTab(windowId, {
      format: 'jpeg',
      quality: 80,
    });
    const m = /^data:image\/\w+;base64,(.+)$/.exec(dataUrl);
    return m?.[1] ?? null;
  } catch {
    return null;
  }
}
