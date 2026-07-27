/**
 * Official empty-state pin tip (Ti + Ei):
 *   light/dark extension-*-min art, title "Pin Claude for quick access",
 *   subtitle about the toolbar pin icon. maxDisplays: 1.
 *
 * className 逐字：
 *   外层  flex flex-col items-center justify-center h-full
 *   内层  flex flex-col items-center
 *   图    w-[212px] h-[122px] rounded-[14px]
 *   文    mt-4 flex flex-col items-center gap-1 w-[188px]
 *         font-small-bold text-text-300 / font-small text-text-500
 *
 * 主题图：官方 Mi() 用 matchMedia；我们用 data-mode（与 theme.ts 一致）。
 */

import { useEffect, useState } from 'react';
import { useUi } from '@/i18n/UiLocaleContext';

export interface PinOnboardingProps {
  onDismiss: () => void;
}

export function PinOnboarding({ onDismiss }: PinOnboardingProps) {
  const t = useUi();

  return (
    <div className="flex flex-col items-center justify-center h-full">
      <div className="flex flex-col items-center">
        <PinArt title={t.pinTitle} />
        <div className="mt-4 flex flex-col items-center gap-1 w-[188px]">
          <p className="font-small-bold text-text-300 text-center">{t.pinTitle}</p>
          <p className="font-small text-text-500 text-center">{t.pinSubtitle}</p>
        </div>
        {/* Self-hosted: allow dismiss so empty state can proceed (official maxDisplays:1 via storage only). */}
        <button
          type="button"
          onClick={onDismiss}
          style={{ borderRadius: '38px' }}
          className="mt-6 min-w-[75px] min-h-8 px-[14px] py-[3px] font-base text-text-100 border-[0.5px] border-border-300 bg-bg-000/30 hover:bg-bg-200 transition-colors text-center"
        >
          {t.pinDismiss}
        </button>
      </div>
    </div>
  );
}

function useIsDarkMode(): boolean {
  const [dark, setDark] = useState(() => {
    if (typeof document === 'undefined') return false;
    const mode = document.documentElement.dataset.mode;
    if (mode === 'dark') return true;
    if (mode === 'light') return false;
    return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
  });

  useEffect(() => {
    const el = document.documentElement;
    const read = () => {
      const mode = el.dataset.mode;
      if (mode === 'dark') {
        setDark(true);
        return;
      }
      if (mode === 'light') {
        setDark(false);
        return;
      }
      setDark(window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false);
    };
    read();
    const mo = new MutationObserver(read);
    mo.observe(el, { attributes: true, attributeFilter: ['data-mode'] });
    const mq = window.matchMedia?.('(prefers-color-scheme: dark)');
    const onMq = () => read();
    mq?.addEventListener?.('change', onMq);
    return () => {
      mo.disconnect();
      mq?.removeEventListener?.('change', onMq);
    };
  }, []);

  return dark;
}

/** Theme-aware pin illustration — single img like official Ei. */
export function PinArt({ title }: { title: string }) {
  const dark = useIsDarkMode();
  const light = chrome.runtime.getURL('public/img/extension-light-min.svg');
  const darkSrc = chrome.runtime.getURL('public/img/extension-dark-min.svg');
  return (
    <img
      src={dark ? darkSrc : light}
      alt={title}
      className="w-[212px] h-[122px] rounded-[14px]"
    />
  );
}
