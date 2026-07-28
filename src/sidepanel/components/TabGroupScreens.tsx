/**
 * Official tab-group chrome:
 *  - IZ: "Claude has tab group access" (first-run after Before you start)
 *  - RZ: "Claude is active in this tab group" (secondary tab in managed group)
 *
 * Illustrations: public/img/tabgrp.svg (+ dark).
 */

import { useEffect, useState } from 'react';
import { useUi } from '@/i18n/UiLocaleContext';
import { openMainTabChat } from '@/tabs/groupManager';

function useTabGroupArt(): string {
  const [dark, setDark] = useState(false);
  useEffect(() => {
    const root = document.documentElement;
    const read = () =>
      setDark(
        root.getAttribute('data-mode') === 'dark' ||
          root.classList.contains('dark') ||
          window.matchMedia('(prefers-color-scheme: dark)').matches,
      );
    read();
    const mo = new MutationObserver(read);
    mo.observe(root, { attributes: true, attributeFilter: ['data-mode', 'class'] });
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    mq.addEventListener?.('change', read);
    return () => {
      mo.disconnect();
      mq.removeEventListener?.('change', read);
    };
  }, []);
  return chrome.runtime.getURL(
    dark ? 'public/img/tabgrp_dark.svg' : 'public/img/tabgrp.svg',
  );
}

/** Official IZ — full-screen onboarding step. */
export function TabGroupAccessOnboarding({ onNext }: { onNext: () => void }) {
  const t = useUi();
  const art = useTabGroupArt();

  return (
    <div className="flex flex-col items-center justify-center min-h-screen h-full px-10 bg-bg-100">
      <div className="flex flex-col items-center">
        <img
          src={art}
          alt=""
          className="w-[212px] h-[120px]"
        />
        <div className="text-text-100 text-base font-semibold mt-7 text-center font-claude-response">
          {t.tabGroupAccess}
        </div>
        <div className="text-text-300 text-sm font-normal mt-2 text-center max-w-[320px] font-base">
          {t.tabGroupAccessBody}
        </div>
        <button
          type="button"
          onClick={onNext}
          data-test-id="onboarding-continue"
          className="mt-7 px-[14px] py-2 bg-text-100 text-bg-100 rounded-[14px] hover:bg-text-200 transition-colors font-ui font-medium text-[14px]"
        >
          {t.tabGroupOnboardingNext}
        </button>
      </div>
    </div>
  );
}

/** Official RZ — secondary tab in an active Claude group. */
export function SecondaryTabScreen({
  mainTabId,
  onSwitched,
}: {
  mainTabId: number;
  onSwitched?: () => void;
}) {
  const t = useUi();
  const art = useTabGroupArt();

  return (
    <div className="flex flex-col items-center justify-center min-h-screen h-full bg-bg-100">
      <div className="flex flex-col items-center">
        <img src={art} alt="" className="w-[212px] h-[120px]" />
        <div className="text-text-200 text-base font-semibold mt-7 text-center font-claude-response">
          {t.tabGroupActiveTitle}
        </div>
        <div className="text-text-300 text-sm font-normal mt-2 text-center max-w-[320px] font-base">
          {t.tabGroupActiveBody}
        </div>
        <button
          type="button"
          onClick={() => {
            void openMainTabChat(mainTabId).then(() => onSwitched?.());
          }}
          className="mt-7 px-5 py-[10px] border border-border-300 text-text-200 rounded-[14px] hover:bg-bg-200 transition-colors font-ui font-medium text-[14px]"
        >
          {t.tabGroupOpenChat}
        </button>
      </div>
    </div>
  );
}
