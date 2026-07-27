/**
 * Official skip-mode frame (QZ + XZ in Claude in Chrome sidepanel bundle):
 * solid gold 2px #F7CE46 + dark dashed #31290E (dash 9 / gap 9), radius 16.
 * Used when permission mode is "Act without asking" / skip.
 */

import { useEffect, useRef, useState } from 'react';

export function SkipModeBorder({ active }: { active: boolean }) {
  if (!active) return null;
  return (
    <div
      className="absolute inset-0 pointer-events-none z-[60] transition-opacity duration-200"
      aria-hidden
    >
      <div
        className="absolute inset-0"
        style={{
          border: '2px solid #F7CE46',
          borderRadius: '16px',
          boxSizing: 'border-box',
        }}
      />
      <DashedRoundedBorder
        strokeColor="#31290E"
        strokeWidth={2}
        dashLength={9}
        gapLength={9}
        borderRadius={16}
      />
    </div>
  );
}

function DashedRoundedBorder({
  strokeColor,
  strokeWidth = 2,
  dashLength = 10,
  gapLength = 10,
  borderRadius = 16,
}: {
  strokeColor: string;
  strokeWidth?: number;
  dashLength?: number;
  gapLength?: number;
  borderRadius?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const measure = () => {
      if (!ref.current) return;
      const rect = ref.current.getBoundingClientRect();
      setSize({ width: rect.width, height: rect.height });
    };
    measure();
    window.addEventListener('resize', measure);
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    if (ref.current && ro) ro.observe(ref.current);
    return () => {
      window.removeEventListener('resize', measure);
      ro?.disconnect();
    };
  }, []);

  const { width, height } = size;
  const r = Math.min(borderRadius, Math.min(width, height) / 2 || borderRadius);
  const perimeter = 2 * (width + height - 4 * r) + 2 * Math.PI * r;
  const cycle = dashLength + gapLength;
  const unit = perimeter > 0 ? perimeter / Math.max(1, Math.round(perimeter / cycle)) : cycle;
  const dash = (dashLength / cycle) * unit;
  const gap = unit - dash;

  return (
    <div
      ref={ref}
      className="absolute inset-0 pointer-events-none overflow-hidden"
      style={{ zIndex: 41 }}
    >
      {width > 0 && height > 0 ? (
        <svg
          width={width}
          height={height}
          style={{ position: 'absolute', top: 0, left: 0, overflow: 'hidden' }}
        >
          <rect
            x={strokeWidth / 2}
            y={strokeWidth / 2}
            width={width - strokeWidth}
            height={height - strokeWidth}
            rx={r}
            ry={r}
            fill="none"
            stroke={strokeColor}
            strokeWidth={strokeWidth}
            strokeDasharray={`${dash} ${gap}`}
            strokeDashoffset={dash / 2}
            pathLength={perimeter}
          />
        </svg>
      ) : null}
    </div>
  );
}
