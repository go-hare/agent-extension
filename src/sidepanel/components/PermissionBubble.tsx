/**
 * 授权气泡 —— 整个扩展里**唯一**的 grant 入口。
 *
 * 布局 / className / 文案结构逐字对齐原版 `CZ` 组件
 * （`assets/sidepanel-CEYFzMrx.js`）：
 *
 *   根: bg-bg-000 rounded-[14px]（无 my-2）
 *   头: flex items-center gap-2 py-[10px] px-4  +  20px 盾牌 + "New permissions required"
 *   线: border-t border-border-300 mb-4
 *   体: space-y-4 px-4  →  "Claude wants to {verb}:" + host（font-*-code, dir=ltr）
 *   选: 与 space-y-4 **同级**（不在里面）
 *       Allow this action / Decline / 分割线 / Always allow… (height "55px")
 *   脚: "Claude will not purchase items… settings."
 *
 * 按钮 QC 的 className 原样。
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { cn } from './cn';
import { availableScopes } from '@/permissions/manager';
import { PERMISSION, type PermissionScope } from '@/shared/types';
import { ShieldIcon } from './icons';
import type { PermissionItem } from '../state/transcript';
import { useUi } from '@/i18n/UiLocaleContext';

/** 键盘去抖：先亮 isActive，再真正提交。原版 150ms。 */
const KEY_ARM_DELAY = 150;
const COMMIT_DELAY = 150;

/** actionLabel 可能含页面来源文字，限长防止撑爆布局。 */
const LABEL_MAX = 160;

export interface PermissionBubbleProps {
  item: PermissionItem;
  onAnswer: (toolUseId: string, granted: boolean, scope: PermissionScope) => void;
}

type ActiveChoice = 'once' | 'deny' | 'always' | null;

export function PermissionBubble({ item, onAnswer }: PermissionBubbleProps) {
  const t = useUi();
  const { request, answer } = item;
  const answered = answer !== undefined;

  const scopes = useMemo(() => availableScopes(request.permission), [request.permission]);
  const canAlways = scopes.includes('always');
  const isPlan = request.permission === PERMISSION.PLAN_APPROVAL;

  const [armed, setArmed] = useState(false);
  const [active, setActive] = useState<ActiveChoice>(null);
  const committed = useRef(false);

  useEffect(() => {
    if (answered) return;
    const t = window.setTimeout(() => setArmed(true), KEY_ARM_DELAY);
    return () => window.clearTimeout(t);
  }, [answered]);

  const commit = (granted: boolean, scope: PermissionScope, choice: ActiveChoice) => {
    if (committed.current || answered) return;
    committed.current = true;
    setActive(choice);
    window.setTimeout(() => {
      onAnswer(request.toolUseId, granted, scope);
    }, COMMIT_DELAY);
  };

  // Enter = once；Cmd/Ctrl+Enter = always；Escape = deny。原版无 arm 延迟，
  // 我们多 150ms 防侧栏刚打开时的误触；真正 commit 仍是 150ms flash。
  useEffect(() => {
    if (answered || !armed) return;

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        commit(false, 'once', 'deny');
        return;
      }
      if (e.key === 'Enter') {
        if (e.isComposing || e.keyCode === 229) return;
        e.preventDefault();
        if ((e.metaKey || e.ctrlKey) && canAlways) {
          commit(true, 'always', 'always');
        } else {
          commit(true, 'once', 'once');
        }
      }
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [answered, armed, canAlways, request.toolUseId]);

  return (
    <div className="bg-bg-000 rounded-[14px]">
      <div className="flex items-center gap-2 py-[10px] px-4">
        <ShieldIcon size={20} className="text-text-100" />
        <h3 className="font-base text-text-100">
          {answered ? t.permission : t.newPermissionsRequired}
        </h3>
      </div>

      <div className="border-t border-border-300 mb-4" />

      {/* 内容区：只放 "wants to" + host + 可选截图。Choices 在外面。 */}
      <div className="space-y-4 px-4">
        <div>
          <p className="font-base-bold text-text-100">
            {isPlan
              ? t.claudeWantsApproval
              : t.claudeWantsTo(verbFor(request.permission, t))}
          </p>
          {request.host ? (
            <p dir="ltr" className="font-claude-response-code text-text-200">
              {request.host}
            </p>
          ) : null}
          {request.actionLabel && request.actionLabel !== request.host ? (
            <p dir="ltr" className="font-claude-response-code text-text-300 mt-1 break-words">
              {clip(request.actionLabel)}
            </p>
          ) : null}
        </div>

        {request.screenshot && !answered ? (
          <div>
            <img
              src={request.screenshot}
              alt="Preview of the page area this action targets"
              className="mx-auto rounded-lg border-[0.5px] border-border-300"
            />
          </div>
        ) : null}
      </div>

      {answered ? (
        <div className="px-4 pb-3">
          <AnsweredNote granted={answer.granted} scope={answer.scope} />
        </div>
      ) : (
        <Choices canAlways={canAlways} isPlan={isPlan} active={active} onPick={commit} />
      )}
    </div>
  );
}

function Choices({
  canAlways,
  isPlan,
  active,
  onPick,
}: {
  canAlways: boolean;
  isPlan: boolean;
  active: ActiveChoice;
  onPick: (granted: boolean, scope: PermissionScope, choice: ActiveChoice) => void;
}) {
  const t = useUi();
  return (
    <div className="px-3 py-[10px] space-y-[5px] mt-[10px] mb-0.5">
      <ScopeButton isActive={active === 'once'} onClick={() => onPick(true, 'once', 'once')}>
        <span>{isPlan ? t.approvePlan : t.allowOnce}</span>
        <Kbd hint="↵" />
      </ScopeButton>

      <ScopeButton isActive={active === 'deny'} onClick={() => onPick(false, 'once', 'deny')}>
        <span>{isPlan ? t.makeChanges : t.decline}</span>
        <Kbd hint="Esc" />
      </ScopeButton>

      <div className="border-t-[0.5px] border-border-300 my-3 -mx-3" />

      {canAlways ? (
        <ScopeButton
          isActive={active === 'always'}
          height="55px"
          onClick={() => onPick(true, 'always', 'always')}
        >
          <div className="flex flex-col items-start">
            <span>{t.alwaysAllowSite}</span>
            <span className="font-small text-text-500">{t.browseClickType}</span>
          </div>
          <span className="flex items-center gap-0.5">
            <Kbd hint="⌘" />
            <Kbd hint="↵" />
          </span>
        </ScopeButton>
      ) : (
        <p className="font-small text-text-500 px-1 mt-2">{t.sitePermissionsDisabled}</p>
      )}

      <p className="font-small text-text-500 px-1 mt-2">
        {t.permissionFooter}{' '}
        <button
          type="button"
          onClick={() => void chrome.runtime.openOptionsPage()}
          className="inline-link hover:text-text-400"
        >
          {t.settingsLink}
        </button>
        .
      </p>
    </div>
  );
}

/**
 * 原版 QC 按钮。
 * isActive 时用 bg-bg-300（键盘触发后 150ms 高亮），不是 primary 实心。
 */
function ScopeButton({
  children,
  isActive,
  height,
  onClick,
}: {
  children: React.ReactNode;
  isActive?: boolean;
  height?: string | number;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={height ? { height } : undefined}
      className={cn(
        'w-full font-base flex min-w-[75px] px-[14px] py-[3px] justify-between items-center gap-2',
        'rounded-lg border-[0.5px] transition-colors font-medium',
        isActive
          ? 'text-text-100 bg-bg-300 border-border-400'
          : 'text-text-100 border-border-200 hover:bg-bg-100',
        !height && 'h-9',
      )}
    >
      {children}
    </button>
  );
}

function Kbd({ hint }: { hint: string }) {
  return <span className="font-small shrink-0 text-[0.6875rem] text-text-500">{hint}</span>;
}

function AnsweredNote({ granted, scope }: { granted: boolean; scope: PermissionScope }) {
  const t = useUi();
  return (
    <p className={cn('font-small px-1 pb-1', granted ? 'text-text-500' : 'text-danger-100')}>
      {granted
        ? scope === 'always'
          ? t.allowedRemembered
          : t.allowedOnce
        : t.declined}
    </p>
  );
}

function verbFor(permission: string, t: ReturnType<typeof useUi>): string {
  switch (permission) {
    case PERMISSION.READ_PAGE_CONTENT:
      return t.verbRead;
    case PERMISSION.CLICK:
      return t.verbClick;
    case PERMISSION.TYPE:
      return t.verbType;
    case PERMISSION.NAVIGATE:
      return t.verbNavigate;
    case PERMISSION.EXECUTE_JAVASCRIPT:
      return t.verbJs;
    case PERMISSION.UPLOAD_IMAGE:
      return t.verbUpload;
    case PERMISSION.READ_CONSOLE_MESSAGES:
      return t.verbConsole;
    case PERMISSION.READ_NETWORK_REQUESTS:
      return t.verbNetwork;
    case PERMISSION.PLAN_APPROVAL:
      return t.verbPlan;
    default:
      return t.verbAct;
  }
}

function clip(s: string): string {
  const flat = s.replace(/\s+/g, ' ').trim();
  return flat.length <= LABEL_MAX ? flat : `${flat.slice(0, LABEL_MAX)}…`;
}
