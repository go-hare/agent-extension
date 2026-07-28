/**
 * Official Claude spark indicator (`li` in sidepanel-CEYFzMrx.js).
 *
 * Writing state: 8-frame vertical sprite from official
 * `animations-CpPrYwps.js` (`writing`: frameCount 8, speed 90).
 *
 * Official drives frames with **WAAPI** (not CSS @keyframes):
 *   frames = Array.from({length:8}, (_, n) =>
 *     ({ transform: `translateY(-${n * (100/8)}%)` }))
 *   el.animate(frames, {
 *     duration: 90 * 8,
 *     iterations: Infinity,
 *     easing: 'steps(8, jump-none)',
 *   })
 *
 * StatusPill passes `className="!w-5 !text-brand-200"`.
 * Default li size is w-8 + text-accent-brand.
 *
 * Sprite: public/img/claude-spark-writing.svg (byte-identical to official).
 * Static fallback = single-frame starburst (`ci`).
 *
 * NOTE: official uses Tailwind arbitrary `[&>svg]:block [&>svg]:w-full
 * [&>svg]:fill-current`. Those utilities are NOT always present in the
 * prebuilt CSS dump — we apply the same rules via a tiny style tag / inline
 * so the strip actually fills the 1:1 clip window (otherwise multi-frame
 * SVG bleeds and looks like a broken plant glyph).
 */

import { useEffect, useRef } from 'react';
import { cn } from './cn';
import { ClaudeSparkIcon } from './icons';
import writingSprite from '../../../public/img/claude-spark-writing.svg?raw';

export type ClaudeSparkState = 'static' | 'writing' | 'thinking';

/** Mirror animations-CpPrYwps.js `writing` entry. */
const WRITING = { frameCount: 8, speed: 90, width: 100, height: 100 } as const;

export function ClaudeSpark({
  state = 'static',
  className,
}: {
  state?: ClaudeSparkState;
  className?: string;
}) {
  const stripRef = useRef<HTMLDivElement>(null);
  const animated = state === 'writing' || state === 'thinking';
  const reduced =
    typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  const useSprite = animated && !reduced && Boolean(writingSprite);

  useEffect(() => {
    const el = stripRef.current;
    if (!el || !useSprite) return;
    if (typeof el.animate !== 'function') return;

    const { frameCount, speed } = WRITING;
    // Official: translateY(-n * (100/frameCount)%) for n = 0 .. frameCount-1
    const frames = Array.from({ length: frameCount }, (_, n) => ({
      transform: `translateY(-${n * (100 / frameCount)}%)`,
    }));
    const anim = el.animate(frames, {
      duration: speed * frameCount,
      iterations: Infinity,
      easing: `steps(${frameCount}, jump-none)`,
    });
    return () => {
      anim.cancel();
    };
  }, [useSprite, state]);

  if (!useSprite) {
    // Official static branch: w-8 text-accent-brand + ci, StatusPill overrides size/color
    return (
      <div
        className={cn(
          'w-8 text-accent-brand inline-block select-none',
          className,
        )}
        aria-hidden
      >
        <ClaudeSparkIcon size={20} className="w-full h-full fill-current" />
      </div>
    );
  }

  // Official writing: aspectRatio = width/height of ONE frame (= 1)
  const aspect = WRITING.width / WRITING.height;

  return (
    <div
      className={cn(
        'w-8 text-accent-brand inline-block overflow-hidden select-none',
        className,
      )}
      style={{ aspectRatio: aspect }}
      aria-hidden
    >
      <div
        ref={stripRef}
        className="claude-spark-writing"
        dangerouslySetInnerHTML={{
          __html: injectSvgFill(writingSprite),
        }}
      />
    </div>
  );
}

/** Ensure root <svg> fills width and uses currentColor (official fill-current). */
function injectSvgFill(raw: string): string {
  if (!raw.includes('<svg')) return raw;
  // Already has fill? still force width 100% + display block + fill currentColor
  return raw.replace(/<svg\b([^>]*)>/, (_m, attrs: string) => {
    let a = attrs;
    if (!/\bfill=/.test(a)) a += ' fill="currentColor"';
    if (!/\bstyle=/.test(a)) {
      a += ' style="display:block;width:100%;height:auto"';
    }
    return `<svg${a}>`;
  });
}
