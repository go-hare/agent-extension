/**
 * Resolve the browser tab the side panel should act on.
 *
 * Side-panel pages are not a normal browser window: `currentWindow: true`
 * often returns nothing or the wrong window after the panel steals focus.
 * Prefer last-focused normal window, then fall back.
 */

export type ActiveTab = {
  id: number;
  windowId: number;
  url: string;
  title: string;
};

function isUsableTab(t: chrome.tabs.Tab | undefined): t is chrome.tabs.Tab & { id: number } {
  if (!t?.id) return false;
  const url = t.url ?? '';
  // Never anchor to our own extension pages / DevTools.
  if (url.startsWith('chrome-extension://')) return false;
  if (url.startsWith('devtools://')) return false;
  return true;
}

function toActive(t: chrome.tabs.Tab & { id: number }): ActiveTab {
  return {
    id: t.id,
    windowId: t.windowId,
    url: t.url ?? '',
    title: t.title ?? '',
  };
}

export async function resolveActiveBrowserTab(): Promise<ActiveTab | null> {
  try {
    // 1) Last focused normal window's active tab (best from side panel).
    const lastFocused = await chrome.tabs.query({
      active: true,
      lastFocusedWindow: true,
    });
    const a = lastFocused.find(isUsableTab);
    if (a) return toActive(a);

    // 2) currentWindow (works when the panel is still associated).
    const current = await chrome.tabs.query({ active: true, currentWindow: true });
    const b = current.find(isUsableTab);
    if (b) return toActive(b);

    // 3) Scan normal windows for an active http(s)/file tab.
    const wins = await chrome.windows.getAll({ populate: true, windowTypes: ['normal'] });
    // Prefer focused window first.
    const ordered = [...wins].sort((x, y) => Number(y.focused) - Number(x.focused));
    for (const w of ordered) {
      const active = w.tabs?.find((t) => t.active && isUsableTab(t));
      if (active && isUsableTab(active)) return toActive(active);
    }

    // 4) Any non-extension tab in a normal window.
    for (const w of ordered) {
      const any = w.tabs?.find((t) => isUsableTab(t));
      if (any && isUsableTab(any)) return toActive(any);
    }
  } catch {
    /* permissions / startup race */
  }
  return null;
}
