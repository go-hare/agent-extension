/**
 * Lightweight safety blocklist + blocked.html redirect helpers.
 *
 * Official 1.0.81 uses a multi-category blocklist (category1 hard block →
 * blocked.html rewrite). We ship the same interstitial page and a small
 * hard-block URL matcher so agent navigations can be redirected safely.
 * Full managed-org categories remain out of scope.
 */

import { blockedUrlFor, isBlockedPageUrl } from '@/pages/paths';

/** Hard-block host patterns (category1-ish). Keep conservative. */
const HARD_BLOCK_HOST_RE =
  /(?:^|\.)(onlyfans\.com|pornhub\.com|xvideos\.com|xnxx\.com|chaturbate\.com|stripchat\.com)$/i;

export function isHardBlockedUrl(url: string | undefined | null): boolean {
  if (!url) return false;
  if (isBlockedPageUrl(url)) return true;
  try {
    const u = new URL(url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') {
      // chrome://, file://, etc. — agent shouldn't drive these; treat as soft.
      return false;
    }
    return HARD_BLOCK_HOST_RE.test(u.hostname);
  } catch {
    return false;
  }
}

/**
 * If url is hard-blocked, return the blocked.html interstitial URL.
 * Otherwise return null (caller keeps original).
 */
export function maybeBlockedInterstitial(url: string): string | null {
  if (!isHardBlockedUrl(url)) return null;
  if (isBlockedPageUrl(url)) return url;
  return blockedUrlFor(url);
}

/**
 * Redirect a tab to the official blocked interstitial when the URL is hard-blocked.
 * Returns true if a redirect was performed.
 */
export async function redirectTabIfBlocked(tabId: number, url: string): Promise<boolean> {
  const target = maybeBlockedInterstitial(url);
  if (!target || target === url) return false;
  try {
    await chrome.tabs.update(tabId, { url: target });
    return true;
  } catch {
    return false;
  }
}
