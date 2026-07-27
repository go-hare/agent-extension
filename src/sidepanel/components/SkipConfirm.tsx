/**
 * 切到 "Act without asking" 时的二次确认。
 *
 * 原版 HZ 组件（sidepanel-CEYFzMrx.js）结构：
 *   全屏遮罩: w-full h-screen bg-bg-100 flex items-center justify-center p-5 absolute inset-0 z-50
 *   内层: max-w-[520px] w-full
 *   logo 行 + h2 "Skip all permissions across the internet?"
 *   danger WARNING 列表 4 条 + risks 链接
 *   Cancel / Skip permissions（rounded-[14px], gap-3）
 */

import { WarningIcon } from './icons';
import { useUi } from '@/i18n/UiLocaleContext';

const RISKS_URL =
  'https://support.claude.com/en/articles/12012173-getting-started-with-claude-for-chrome#h_91c6e5a1ee';

export interface SkipConfirmProps {
  open: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

export function SkipConfirm({ open, onCancel, onConfirm }: SkipConfirmProps) {
  const t = useUi();
  if (!open) return null;

  const logoSrc =
    typeof chrome !== 'undefined' && chrome.runtime?.getURL
      ? chrome.runtime.getURL('public/icons/logo.svg')
      : '/public/icons/logo.svg';

  return (
    // 原版 HZ 挂在全屏 shell 上用 absolute inset-0。本组件在 sticky Composer 内渲染，
    // absolute 只会盖住输入区，故用 fixed 等价覆盖整个 sidepanel 视口。
    <div className="fixed inset-0 z-50 w-full h-screen bg-bg-100 flex items-center justify-center p-5">
      <div className="max-w-[520px] w-full" role="dialog" aria-modal="true" aria-labelledby="skip-title">
        <div className="flex justify-start mb-4">
          <img src={logoSrc} alt="" width={28} height={28} className="h-7 w-7" />
        </div>

        <h2 id="skip-title" className="font-claude-response-heading text-text-100 mb-4">
          {t.skipAllTitle}
        </h2>

        <div className="bg-danger-900 border-[0.5px] border-danger-200 rounded-lg p-4 mb-4">
          <h3 className="text-[14px] font-ui font-medium text-danger-000 leading-[140%] mb-2.5 flex items-center gap-1">
            <WarningIcon size={16} className="text-danger-000" />
            {t.warning}
          </h3>
          <ul className="text-[14px] font-ui font-normal text-danger-000 leading-[140%] ml-4 list-disc space-y-2">
            <li>{t.skipRisk1}</li>
            <li>{t.skipRisk2}</li>
            <li>{t.skipRisk3}</li>
            <li>
              {t.skipRisk4Before}{' '}
              <button
                type="button"
                onClick={() => void chrome.tabs.create({ url: RISKS_URL })}
                className="text-danger-000 inline-link hover:no-underline focus:outline-none"
              >
                {t.skipRisk4Link}
              </button>{' '}
              {t.skipRisk4After}
            </li>
          </ul>
        </div>

        <div className="flex justify-end gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="px-[14px] py-2 border border-border-300 text-text-200 rounded-[14px] hover:bg-bg-200 transition-colors font-ui font-medium text-[14px]"
          >
            {t.cancel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="px-[14px] py-2 bg-text-100 text-bg-100 rounded-[14px] hover:bg-text-200 transition-colors font-ui font-medium text-[14px]"
          >
            {t.skipPermissions}
          </button>
        </div>
      </div>
    </div>
  );
}
