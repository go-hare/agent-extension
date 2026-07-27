/**
 * 空对话时的引导页。
 *
 * className 逐字取自原版：
 *   容器  flex flex-col items-center justify-center h-full px-4 py-8
 *   logo  w-12 h-12 rounded-xl border-[0.5px] border-border-300 bg-always-white shadow-sm mb-4 overflow-hidden
 *   标题  font-ui-sm text-text-500 mb-[22px]
 *   chips flex flex-col items-center gap-2 w-full max-w-sm
 *   chip  min-w-[75px] min-h-8 px-[14px] py-[3px] … style borderRadius 38px
 *
 * 文案对齐原版 greeting："Hi, I'm Claude. How can I help you today?"
 */

import { useUi } from '@/i18n/UiLocaleContext';

export interface EmptyStateProps {
  /** 没配 key 时提示语换成引导配置，点击也跳配置页而不是发消息。 */
  configured: boolean;
  onPick: (text: string) => void;
  onOpenOptions: () => void;
  /** Open Teach Claude / Record workflow full panel. */
  onTeach?: () => void;
}

export function EmptyState({ configured, onPick, onOpenOptions, onTeach }: EmptyStateProps) {
  const t = useUi();
  const suggestions = [t.suggestionSummarize, t.suggestionPricing, t.suggestionForm];

  return (
    <div className="flex flex-col items-center justify-center h-full px-4 py-8">
      <div className="w-12 h-12 rounded-xl border-[0.5px] border-border-300 bg-always-white shadow-sm mb-4 overflow-hidden">
        <img
          src={chrome.runtime.getURL('public/icons/logo.svg')}
          alt=""
          className="w-full h-full object-cover"
        />
      </div>

      <h2 className="font-ui-sm text-text-500 mb-[22px]">
        {configured ? t.emptyGreeting : t.emptyNeedSetup}
      </h2>

      <div className="flex flex-col items-center gap-2 w-full max-w-sm">
        {configured ? (
          <>
            {suggestions.map((s) => (
              <Chip key={s} onClick={() => onPick(s)}>
                {s}
              </Chip>
            ))}
            {onTeach ? (
              <Chip onClick={onTeach}>{t.suggestionTeach}</Chip>
            ) : null}
          </>
        ) : (
          <Chip onClick={onOpenOptions}>{t.openSettings}</Chip>
        )}
      </div>
    </div>
  );
}

function Chip({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{ borderRadius: '38px' }}
      className="min-w-[75px] min-h-8 px-[14px] py-[3px] font-base text-text-100 border-[0.5px] border-border-300 bg-bg-000/30 hover:bg-bg-200 transition-colors text-center line-clamp-2 break-words"
    >
      {children}
    </button>
  );
}
