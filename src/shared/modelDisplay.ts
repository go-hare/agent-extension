/**
 * Model id → header label, matching Claude in Chrome / local-cfc display rules.
 *
 *   claude-sonnet-4-5-20250929 → Sonnet 4.5
 *   claude-opus-4-20250514     → Opus 4
 *   claude-haiku-3-5           → Haiku 3.5
 */

export function displayNameFromModelId(id: string | undefined | null): string {
  const s = String(id || '').trim();
  if (!s) return '';

  // Anthropic ids:
  //   claude-sonnet-4-5-20250929 → Sonnet 4.5
  //   claude-opus-4-20250514     → Opus 4   (8-digit date is NOT a minor)
  //   claude-sonnet-4.5          → Sonnet 4.5
  //   claude-haiku-3-5           → Haiku 3.5
  const m =
    s.match(/(?:^|[/])claude-(sonnet|opus|haiku)-(\d+)(?:\.(\d+)|-(\d{1,2}))?(?:[-_]|$)/i) ??
    s.match(/^(sonnet|opus|haiku)[-_ ]?(\d+)(?:\.(\d+)|-(\d{1,2}))?(?:[-_]|$)?/i);
  if (m) {
    const family = m[1].charAt(0).toUpperCase() + m[1].slice(1).toLowerCase();
    const major = m[2];
    const minor = m[3] || m[4]; // dotted or short hyphen minor (not YYYYMMDD)
    return minor ? `${family} ${major}.${minor}` : `${family} ${major}`;
  }

  if (s.length <= 32) return s;
  return `${s.slice(0, 28)}…`;
}
