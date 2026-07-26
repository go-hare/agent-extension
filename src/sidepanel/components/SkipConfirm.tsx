/**
 * 切到 "Act without asking" 时的二次确认。
 *
 * 原版 HZ 组件（sidepanel-CEYFzMrx.js）结构：
 *   全屏遮罩: w-full h-screen bg-bg-100 flex items-center justify-center p-5 absolute inset-0 z-50
 *   内层: max-w-[520px] w-full
 *   logo 行 + h2 "Skip all permissions across the internet?"
 *   danger WARNING 列表 4 条 + risks 链接
 *   Cancel / Skip permissions（rounded-[14px], gap-3）
 *
 * 这是用户的**心理刹车** —— 原版也是先问再切。
 * 不可逆/敏感/JS/plan 仍然会弹权限气泡（PermissionManager 保证）。
 */

import { WarningIcon } from './icons';

const RISKS_URL =
  'https://support.claude.com/en/articles/12012173-getting-started-with-claude-for-chrome#h_91c6e5a1ee';

export interface SkipConfirmProps {
  open: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

export function SkipConfirm({ open, onCancel, onConfirm }: SkipConfirmProps) {
  if (!open) return null;

  const logoSrc =
    typeof chrome !== 'undefined' && chrome.runtime?.getURL
      ? chrome.runtime.getURL('public/icons/logo.svg')
      : '/public/icons/logo.svg';

  return (
    // fixed：Composer 在 sticky 槽里，absolute 只会盖住输入区；侧栏根不一定 position:relative。
    // 原版 absolute inset-0 挂在全屏 shell 上，这里用 fixed 等价盖住整个 sidepanel 视口。
    <div className="fixed inset-0 z-50 w-full h-screen bg-bg-100 flex items-center justify-center p-5">
      <div className="max-w-[520px] w-full" role="dialog" aria-modal="true" aria-labelledby="skip-title">
        <div className="flex justify-start mb-4">
          <img src={logoSrc} alt="" width={28} height={28} className="h-7 w-7" />
        </div>

        <h2
          id="skip-title"
          className="text-text-100 font-ui font-medium text-[20px] leading-[140%] mb-4"
        >
          Skip all permissions across the internet?
        </h2>

        <div className="bg-danger-900 border-[0.5px] border-danger-200 rounded-lg p-4 mb-4">
          <h3 className="text-[14px] font-ui font-medium text-danger-000 leading-[140%] mb-2.5 flex items-center gap-1">
            <WarningIcon size={16} className="text-danger-000" />
            WARNING
          </h3>
          <ul className="text-[14px] font-ui font-normal text-danger-000 leading-[140%] ml-4 list-disc space-y-2">
            <li>This allows Claude to take any action on the internet.</li>
            <li>This mode puts your data and the data of others at risk from malicious code.</li>
            <li>
              You should oversee Claude when it is in this mode. You are fully responsible for all
              risks associated with permission-less Claude.
            </li>
            <li>
              Review{' '}
              <button
                type="button"
                onClick={() => void chrome.tabs.create({ url: RISKS_URL })}
                className="text-danger-000 inline-link hover:no-underline focus:outline-none"
              >
                risks
              </button>{' '}
              before you begin.
            </li>
          </ul>
        </div>

        <div className="flex justify-end gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="px-[14px] py-2 border border-border-300 text-text-200 rounded-[14px] hover:bg-bg-200 transition-colors font-ui font-medium text-[14px]"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="px-[14px] py-2 bg-text-100 text-bg-100 rounded-[14px] hover:bg-text-200 transition-colors font-ui font-medium text-[14px]"
          >
            Skip permissions
          </button>
        </div>
      </div>
    </div>
  );
}
