/**
 * Official BM banner strip above the chat input.
 *
 * Source: sidepanel-CEYFzMrx.js
 *   BM=({type, children, onAction, onDismiss, actionText, actionIcon, dismissWithGradient})
 *
 * Notification variant:
 *   bg-bg-300 dark:bg-bg-400 + text-text-200
 *   rounded-t-[14px] px-4 py-2 flex items-center justify-between
 *   action: bg-text-100 text-bg-000 px-3 py-1 rounded-md text-xs + bell
 *   dismiss: X size 12
 */

import type { ReactNode } from 'react';
import { cn } from './cn';
import { BellIcon, X } from './icons';

export type BannerType =
  | 'notification'
  | 'error'
  | 'refusal'
  | 'danger'
  | 'announcement';

function bgFor(type: BannerType): string {
  switch (type) {
    case 'refusal':
    case 'error':
    case 'danger':
      return 'bg-danger-900';
    case 'announcement':
      return 'bg-[#D4E7F7] dark:bg-[#2B5278]';
    default:
      return 'bg-bg-300 dark:bg-bg-400';
  }
}

function textFor(type: BannerType): string {
  switch (type) {
    case 'refusal':
    case 'error':
    case 'danger':
      return 'text-danger-100 dark:text-danger-000';
    case 'announcement':
      return 'text-[#1E5A8E] dark:text-[#D4E7F7]';
    default:
      return 'text-text-200 dark:text-text-300';
  }
}

export interface ComposerBannerProps {
  type?: BannerType;
  children: ReactNode;
  onAction?: () => void;
  onDismiss?: () => void;
  actionText?: string;
  /** Defaults to official bell for notification type */
  actionIcon?: ReactNode;
  dismissLabel?: string;
}

export function ComposerBanner({
  type = 'notification',
  children,
  onAction,
  onDismiss,
  actionText,
  actionIcon,
  dismissLabel = 'Dismiss',
}: ComposerBannerProps) {
  const showActions = Boolean(onAction || onDismiss);
  const icon =
    actionIcon ??
    (type === 'notification' ? <BellIcon size={16} /> : null);

  return (
    <div className="overflow-hidden">
      <div
        className={cn(
          bgFor(type),
          textFor(type),
          'rounded-t-[14px] px-4 py-2 flex items-center justify-between relative',
        )}
      >
        <div className="text-xs flex-1 min-w-0">{children}</div>
        {showActions ? (
          <div className="flex items-center gap-2 ml-3 shrink-0">
            {onAction && actionText ? (
              <button
                type="button"
                onClick={onAction}
                className={cn(
                  type === 'refusal' || type === 'danger'
                    ? 'bg-danger-100 text-danger-900 dark:bg-danger-000 dark:text-danger-900'
                    : 'bg-text-100 text-bg-000',
                  'px-3 py-1 rounded-md text-xs font-medium hover:opacity-90 transition-opacity flex items-center gap-1',
                )}
              >
                {icon}
                {actionText}
              </button>
            ) : null}
            {onDismiss ? (
              <button
                type="button"
                onClick={onDismiss}
                className="p-1 hover:opacity-70 rounded transition-opacity"
                aria-label={dismissLabel}
              >
                <X size={12} />
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
