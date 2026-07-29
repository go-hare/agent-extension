/**
 * Extension page paths (crxjs emits under src/<page>/index.html).
 * Official 1.0.81 uses root-level pairing.html / blocked.html / … —
 * runtime getURL must use these built paths.
 */

export const PAGES = {
  pairing: 'src/pairing/index.html',
  gifViewer: 'src/gif_viewer/index.html',
  offscreen: 'src/offscreen/index.html',
  blocked: 'src/blocked/index.html',
  arc: 'src/arc/index.html',
  sidepanel: 'src/sidepanel/index.html',
  options: 'src/options/index.html',
} as const;

export function pageUrl(
  page: keyof typeof PAGES,
  query?: Record<string, string | undefined>,
): string {
  const base = chrome.runtime.getURL(PAGES[page]);
  if (!query) return base;
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v != null && v !== '') sp.set(k, v);
  }
  const q = sp.toString();
  return q ? `${base}?${q}` : base;
}

/** Official mx(): wrap a target URL as blocked interstitial. */
export function blockedUrlFor(originalUrl: string): string {
  const blockedBase = chrome.runtime.getURL(PAGES.blocked);
  if (originalUrl.startsWith(blockedBase)) return originalUrl;
  return `${blockedBase}?url=${encodeURIComponent(originalUrl)}`;
}

export function isBlockedPageUrl(url: string | undefined | null): boolean {
  if (!url) return false;
  try {
    return url.startsWith(chrome.runtime.getURL(PAGES.blocked));
  } catch {
    return url.includes('blocked/index.html') || url.includes('blocked.html');
  }
}
