/**
 * Official Claude spark indicator (`li` in sidepanel-CEYFzMrx.js).
 *
 * Writing state uses the 8-frame vertical sprite from official
 * `animations-CpPrYwps.js`:
 *   writing: { width:100, height:100, frameCount:8, speed:90 }
 *   → CSS steps(8, jump-none) translateY over 720ms, infinite
 *
 * Sprite lives at `public/img/claude-spark-writing.svg` and is imported
 * as raw text so Vite packs it (publicDir is off; runtime getURL needs WAR).
 *
 * Static fallback = single-frame starburst (`ci` path in icons).
 */

import { cn } from './cn';
import { ClaudeSparkIcon } from './icons';
// Official 8-frame writing strip (viewBox 0 0 100 800)
import writingSprite from '../../../public/img/claude-spark-writing.svg?raw';

export type ClaudeSparkState = 'static' | 'writing' | 'thinking';

/**
 * Official `li` spark used in StatusPill:
 *   className="!w-5 !text-brand-200"
 *   state="writing" while agent is working
 */
export function ClaudeSpark({
  state = 'static',
  className,
}: {
  state?: ClaudeSparkState;
  className?: string;
}) {
  const animated = state === 'writing' || state === 'thinking';
  const reduced =
    typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  // Official falls back to static `ci` when reduced-motion / no sprite
  if (!animated || reduced || !writingSprite) {
    return (
      <div
        className={cn('w-5 text-brand-200 inline-block select-none', className)}
        aria-hidden
      >
        <ClaudeSparkIcon size={20} className="w-full h-full fill-current" />
      </div>
    );
  }

  // Official writing container (StatusPill uses !w-5):
  //   overflow-hidden + aspect-ratio 1 + steps sprite strip
  return (
    <div
      className={cn(
        'w-5 text-brand-200 inline-block overflow-hidden select-none',
        '[@media(max-resolution:1.99dppx)]:[clip-path:inset(1px_0)]',
        className,
      )}
      style={{ aspectRatio: '1' }}
      aria-hidden
    >
      <div
        className="claude-spark-writing [&>svg]:block [&>svg]:w-full [&>svg]:fill-current"
        dangerouslySetInnerHTML={{ __html: writingSprite }}
      />
    </div>
  );
}
