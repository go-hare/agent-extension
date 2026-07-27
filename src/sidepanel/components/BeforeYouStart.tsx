/**
 * Official first-run gate ("Before you start") — risk acknowledgement
 * before the agent may act in the browser.
 *
 * className 逐字取自 sidepanel-CEYFzMrx.js（AZ / Before you start 段）：
 *   外层  w-full h-screen bg-bg-100 flex items-center justify-center p-5
 *   内层  max-w-[520px] w-full
 *   标题  font-claude-response-heading text-center text-text-100 mb-5
 *   卡片  border border-border-300 rounded-xl mb-5
 *   正文  font-base text-text-300 flex-1
 *   按钮  px-[14px] py-2 bg-text-100 text-bg-100 rounded-[14px] …
 */

import { useUi } from '@/i18n/UiLocaleContext';
import { AlertIcon, ShieldIcon } from './icons';

export interface BeforeYouStartProps {
  onContinue: () => void;
}

export function BeforeYouStart({ onContinue }: BeforeYouStartProps) {
  const t = useUi();

  return (
    <div className="w-full h-screen bg-bg-100 flex items-center justify-center p-5">
      <div className="max-w-[520px] w-full">
        <h1 className="font-claude-response-heading text-center text-text-100 mb-5">
          {t.beforeYouStart}
        </h1>

        <div className="border border-border-300 rounded-xl mb-5">
          <div className="flex gap-3 pt-5 pb-4 px-4">
            <div className="mt-0.5">
              <AlertIcon size={20} className="text-text-100" />
            </div>
            <p className="font-base text-text-300 flex-1">{t.beforeYouStartRisk}</p>
          </div>
          <div className="border-t-[0.5px] border-border-300 px-4" />
          <div className="flex gap-3 py-4 px-4">
            <div className="mt-0.5">
              <ShieldIcon size={20} className="text-text-100" />
            </div>
            <p className="font-base text-text-300 flex-1">{t.tabGroupAccessBody}</p>
          </div>
        </div>

        <div className="flex justify-end">
          <button
            type="button"
            onClick={onContinue}
            className="px-[14px] py-2 bg-text-100 text-bg-100 rounded-[14px] hover:bg-text-200 transition-colors font-ui font-medium text-[14px]"
          >
            {t.beforeYouStartContinue}
          </button>
        </div>
      </div>
    </div>
  );
}
