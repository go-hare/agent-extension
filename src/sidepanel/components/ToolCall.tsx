/**
 * 工具调用行 — className 对齐官方 ToolUseRow / TimelineGroupItem
 * （sidepanel-CEYFzMrx.js Yi / Gi / nS / Ji / gM / YC）。
 *
 * Standard 外壳 (Yi Standard):
 *   ease-out rounded-lg border-[0.5px] flex flex-col font-ui leading-normal
 *   my-3 border-border-300 (+ hover / expanded bg)
 *
 * TimelineGroup (embedded) 走 Gi 时间轴：
 *   左轨 w-[20px] + 1px border 线 + icon/dot
 *   行按钮 group/row …（Timeline 模式不在行内再放 icon）
 *
 * 官方浏览器工具 (nS): 非 debug 时 isExpandingDisabled — 无 caret、不可展开
 * 结果树；只有报错才允许展开。
 *
 * 特殊路由（官方 dispatcher @ ~909736）：
 *   update_plan  → gM（Creating plan… / Created a plan / Plan rejected）
 *   browser_batch → YC（Batch — completed/total + nested JC rows）
 */

import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  CaretDown,
  CheckIcon,
  CloseIcon,
  Globe,
  Layers,
  ListChecks,
} from './icons';
import { cn } from './cn';
import { describeCall } from '../toolDisplay';
import type { ToolItem } from '../state/transcript';
import { useUi } from '@/i18n/UiLocaleContext';

/** Official chrome browser tools — collapse-only unless error (nS isExpandingDisabled). */
const BROWSER_TOOLS = new Set([
  'computer',
  'read_page',
  'find',
  'form_input',
  'javascript_tool',
  'navigate',
  'get_page_text',
  'tabs_context',
  'tabs_create',
  'tabs_close_id',
  'upload_image',
  'file_upload',
  'gif_creator',
  'shortcuts_list',
  'shortcuts_execute',
  // browser_batch / update_plan have dedicated rows (YC / gM) — still listed so
  // any fallback path keeps browser semantics.
  'browser_batch',
  'read_console_messages',
  'read_network_requests',
  'update_plan',
]);

export function ToolCall({
  item,
  /** TimelineGroup 内嵌 → renderMode=TimelineGroup（官方 Gi 轨） */
  embedded = false,
  isFirst = false,
  isLast = false,
}: {
  item: ToolItem;
  embedded?: boolean;
  isFirst?: boolean;
  isLast?: boolean;
}) {
  // Official dispatcher: update_plan → gM, browser_batch → YC (not generic nS/Yi).
  if (item.name === 'update_plan') {
    return (
      <PlanToolRow
        item={item}
        embedded={embedded}
        isFirst={isFirst}
        isLast={isLast}
      />
    );
  }
  if (item.name === 'browser_batch') {
    return (
      <BatchToolRow
        item={item}
        embedded={embedded}
        isFirst={isFirst}
        isLast={isLast}
      />
    );
  }

  const t = useUi();
  const { Icon, label } = describeCall(item.name, item.input, t);
  const running = item.status === 'running';
  const isError = item.status === 'error';
  const isBrowser = BROWSER_TOOLS.has(item.name);
  // Official nS: isExpandingDisabled = !debug && name !== "update_plan"
  // (update_plan already branched above). Expand only on errors for browser tools.
  const expandDisabled = isBrowser && !isError;
  const [expanded, setExpanded] = useState(isError && !expandDisabled);

  const duration =
    item.endedAt !== undefined
      ? ((item.endedAt - item.startedAt) / 1000).toFixed(1)
      : null;

  // Official W/nS icon class is text-text-300 (not text-text-500).
  // Running state is qi shimmer on the label only — never a spinner on the rail.
  const iconEl = (
    <div className="flex items-center justify-center text-text-300 shrink-0">
      <Icon
        size={16}
        className={isError ? 'text-danger-100' : 'text-text-300'}
      />
    </div>
  );

  const canToggle = !expandDisabled;
  const onToggle = canToggle
    ? () => setExpanded((v) => !v)
    : undefined;

  // Official Yi row button (k). TimelineGroup: no left icon in row, no py.
  // hideCaret when expand disabled (official browser tools).
  // Official Yi/Ji: isDisabled → no handleClick + !cursor-default.
  // Do NOT set HTML disabled — browsers gray out the label and break
  // text-text-300 / shimmer styling on non-expandable browser tools.
  const rowBtn = (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={canToggle ? expanded : undefined}
      className={cn(
        'group/row flex flex-row items-center rounded-lg px-2.5 w-full justify-between',
        !embedded && 'py-2',
        'text-text-300',
        canToggle
          ? 'cursor-pointer transition-colors duration-200 hover:text-text-200 hover:text-text-000'
          : '!cursor-default',
      )}
    >
      <div className="flex flex-row items-center gap-2 min-w-0 flex-1">
        {/* Standard only — TimelineGroup puts icon on the rail */}
        {!embedded ? iconEl : null}
        <div
          className={cn(
            // Official Yi: "text-body text-text-500 text-left truncate" + w-0 flex-grow
            // (text-body aliased to font-base metrics in theme.css)
            'text-body text-text-500 text-left truncate w-0 flex-grow',
            isError && 'text-danger-100',
            // Official: a ? qi({children:i}) : i  — running label uses qi shimmer
            running && 'shimmertext',
          )}
        >
          {label}
        </div>
      </div>

      <div className="flex flex-row items-center gap-1.5 shrink-0">
        {/*
          Official secondaryText slot — we use short duration only on Standard
          shells. Timeline (embedded) browser rows stay label-only like nS.
        */}
        {!embedded && duration && item.status !== 'running' ? (
          <p className="pl-1 text-text-500 font-small shrink-0 whitespace-nowrap">
            {duration}s
          </p>
        ) : null}
        {!embedded && item.status === 'ok' ? (
          <CheckIcon size={12} className="shrink-0 text-success-100" />
        ) : null}
        {!embedded && isError ? (
          <CloseIcon size={12} className="shrink-0 text-danger-100" />
        ) : null}
        {canToggle ? (
          <span
            className={cn(
              'inline-flex transition-transform',
              expanded ? 'rotate-180' : 'rotate-0',
            )}
          >
            <CaretDown className="text-text-300" size={16} />
          </span>
        ) : null}
      </div>
    </button>
  );

  const detail =
    expanded && canToggle ? <ToolDetail item={item} /> : null;

  if (embedded) {
    // Official: m===TimelineGroup → Gi({ icon, header: row, children: detail, … })
    return (
      <TimelineGroupItem
        icon={iconEl}
        header={rowBtn}
        isExpanded={Boolean(detail)}
        isFirstItem={isFirst}
        isLastItem={isLast}
        isActive={running && isLast}
        showDotFallback={false}
      >
        {detail}
      </TimelineGroupItem>
    );
  }

  return (
    <div
      className={cn(
        // Official Yi Standard shell
        'ease-out rounded-lg border-[0.5px] flex flex-col font-ui leading-normal my-3 border-border-300',
        !expanded && canToggle && 'hover:bg-bg-200',
        expanded && 'bg-bg-000 shadow-sm',
      )}
    >
      {rowBtn}
      {detail}
    </div>
  );
}

/**
 * Official TimelineGroupItem (Gi) — vertical rail + content.
 * Class strings taken from sidepanel-CEYFzMrx.js.
 */
export function TimelineGroupItem({
  icon,
  header,
  children,
  isFirstItem = false,
  isLastItem = false,
  isExpanded = false,
  isActive = false,
  showDotFallback = true,
  hasCollapseHeader = false,
}: {
  icon?: React.ReactNode;
  header?: React.ReactNode;
  children?: React.ReactNode;
  isFirstItem?: boolean;
  isLastItem?: boolean;
  isExpanded?: boolean;
  isActive?: boolean;
  showDotFallback?: boolean;
  /** When TimelineGroup has a collapse header, first item still draws top rail */
  hasCollapseHeader?: boolean;
}) {
  // Official: c = !hasCollapseHeader && isFirstItem → suppress top segment line
  const suppressTop = !hasCollapseHeader && isFirstItem;
  const dot = showDotFallback ? (
    <div className="size-[8px] rounded-full bg-border-100 mt-0.5" />
  ) : null;
  const railIcon = icon ?? dot;

  return (
    <div className="flex flex-col shrink-0">
      {/* Top connector stub h-[8px] */}
      <div className="flex flex-row h-[8px]">
        <div className="w-[20px] flex justify-center">
          <div
            className={cn('w-[1px] h-full', !suppressTop && 'bg-border-300')}
          />
        </div>
      </div>

      <div
        className={cn(
          'transition-colors rounded-lg',
          // Official Gi: isExpanded → bg-bg-000 only (no isActive wash)
          isExpanded && 'bg-bg-000',
          isActive && !isExpanded && 'opacity-100',
        )}
      >
        {header ? (
          <div className="flex flex-row items-center py-1">
            <div className="w-[20px] flex justify-center shrink-0 text-text-500">
              {railIcon}
            </div>
            <div className="flex-1 min-w-0">{header}</div>
          </div>
        ) : null}

        {children ? (
          <div className="flex flex-row">
            <div className="w-[20px] flex justify-center shrink-0">
              {header ? (
                <div
                  className={cn('w-[1px] h-full', !isLastItem && 'bg-border-300')}
                />
              ) : (
                <div className="flex flex-col items-center pt-1">
                  {railIcon}
                  <div
                    className={cn(
                      'w-[1px] flex-1 mt-1',
                      !(showDotFallback && isLastItem) && 'bg-border-300',
                    )}
                  />
                </div>
              )}
            </div>
            <div className="flex-1 min-w-0">{children}</div>
          </div>
        ) : null}
      </div>

      {/* Bottom connector stub */}
      <div className="flex flex-row h-[8px]">
        <div className="w-[20px] flex justify-center">
          <div
            className={cn('w-[1px] h-full', !isLastItem && 'bg-border-300')}
          />
        </div>
      </div>
    </div>
  );
}

function ToolDetail({ item }: { item: ToolItem }) {
  const images = item.result?.images ?? [];
  const body =
    item.result?.error ??
    (item.result?.output ? clip(item.result.output) : null) ??
    safeJson(item.input);

  return (
    // Official expanded chrome (search/bash pattern):
    //   overflow-hidden
    //     border-[0.5px] border-border-300 rounded-lg mx-2.5 mt-1 mb-2
    //     max-h-[200px] overflow-y-auto bg-bg-000/50
    //       → raw result children (no Input/Output section labels)
    <div className="overflow-hidden">
      <div className="border-[0.5px] border-border-300 rounded-lg mx-2.5 mt-1 mb-2 max-h-[200px] overflow-y-auto bg-bg-000/50">
        <pre
          className={cn(
            'overflow-x-auto whitespace-pre-wrap break-words p-3 font-mono text-xs',
            item.result?.error ? 'text-danger-100' : 'text-text-300',
          )}
        >
          {body}
        </pre>
        {images.length > 0 ? (
          <div className="p-2 flex flex-col gap-1.5">
            {images.map((img, i) => (
              <img
                key={i}
                src={`data:${img.mediaType};base64,${img.data}`}
                alt="Screenshot sent to the model"
                className="w-full rounded-lg border-[0.5px] border-border-300"
              />
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

const UI_CLIP = 4000;

function clip(s: string): string {
  return s.length <= UI_CLIP
    ? s
    : `${s.slice(0, UI_CLIP)}\n\n… ${s.length - UI_CLIP} more characters (the model received all of it)`;
}

function safeJson(v: unknown): string {
  try {
    const s = JSON.stringify(v, null, 2);
    return s === undefined ? String(v) : clip(s);
  } catch {
    return String(v);
  }
}

// ─── Official gM: update_plan stream row ────────────────────────────────────

type PlanPhase = 'creating' | 'approved' | 'rejected';

/**
 * Official gM status from toolResult + isStreaming:
 *   streaming OR no result → "creating"
 *   content includes approved/Approved → "approved"
 *   content includes rejected/Rejected OR is_error → "rejected"
 *   else with result → "approved"
 */
function planPhase(item: ToolItem): PlanPhase {
  if (item.status === 'running') return 'creating';
  if (item.status === 'error') return 'rejected';
  const err = item.result?.error ?? '';
  const out = item.result?.output ?? '';
  const text = `${err}\n${out}`;
  if (/rejected|did not approve|Make changes/i.test(text)) return 'rejected';
  if (/approved/i.test(text)) return 'approved';
  // Successful endTool without error → approved (permission granted).
  if (item.result && !item.result.error) return 'approved';
  return 'creating';
}

function readPlanInput(input: unknown): {
  domains: Array<string | { domain: string; category?: string }>;
  approach: string[];
} {
  const o = (input ?? {}) as {
    domains?: unknown;
    approach?: unknown;
  };
  const domains = Array.isArray(o.domains) ? o.domains : [];
  const approach = Array.isArray(o.approach)
    ? o.approach.filter((s): s is string => typeof s === 'string')
    : [];
  return { domains, approach };
}

function domainLabel(
  entry: string | { domain: string; category?: string },
): string {
  return typeof entry === 'string' ? entry : entry.domain;
}

/**
 * Official gM — update_plan in the stream:
 *   Yi({ icon: ListChecks size 12, text, isStreaming, hideCaret: true, handleClick })
 *   Labels: Creating plan... / Created a plan / Plan rejected
 *   Click (when plan structure present) → read-only eS portal.
 */
function PlanToolRow({
  item,
  embedded,
  isFirst,
  isLast,
}: {
  item: ToolItem;
  embedded: boolean;
  isFirst: boolean;
  isLast: boolean;
}) {
  const t = useUi();
  const [open, setOpen] = useState(false);
  const phase = planPhase(item);
  const plan = useMemo(() => readPlanInput(item.input), [item.input]);
  const hasStructure = plan.domains.length > 0 || plan.approach.length > 0;
  const running = item.status === 'running';

  const label =
    phase === 'creating'
      ? t.creatingPlan
      : phase === 'approved'
        ? t.createdPlan
        : t.planRejectedRow;

  const iconEl = (
    <div className="flex items-center justify-center text-text-500 shrink-0">
      <ListChecks size={12} className="text-text-500" />
    </div>
  );

  const onClick = hasStructure ? () => setOpen(true) : undefined;

  // Official Yi: hideCaret:!0, isDisabled:!m (no plan → disabled), handleClick when plan.
  const rowBtn = (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'group/row flex flex-row items-center rounded-lg px-2.5 w-full justify-between',
        !embedded && 'py-2',
        'text-text-300',
        onClick
          ? 'cursor-pointer transition-colors duration-200 hover:text-text-200 hover:text-text-000'
          : '!cursor-default',
      )}
    >
      <div className="flex flex-row items-center gap-2 min-w-0 flex-1">
        {!embedded ? iconEl : null}
        <div
          className={cn(
            'text-body text-text-500 text-left truncate w-0 flex-grow',
            phase === 'rejected' && 'text-danger-100',
            running && 'shimmertext',
          )}
        >
          {label}
        </div>
      </div>
    </button>
  );

  const portal =
    open && hasStructure
      ? createPortal(
          <ReadOnlyPlanModal
            domains={plan.domains}
            approach={plan.approach}
            onClose={() => setOpen(false)}
          />,
          document.body,
        )
      : null;

  if (embedded) {
    return (
      <>
        <TimelineGroupItem
          icon={iconEl}
          header={rowBtn}
          isExpanded={false}
          isFirstItem={isFirst}
          isLastItem={isLast}
          isActive={running && isLast}
          showDotFallback={false}
        />
        {portal}
      </>
    );
  }

  return (
    <>
      <div className="ease-out rounded-lg border-[0.5px] flex flex-col font-ui leading-normal my-3 border-border-300">
        {rowBtn}
      </div>
      {portal}
    </>
  );
}

/**
 * Official eS isReadOnly portal (gM click):
 *   fixed inset-0 z-[60] flex items-center justify-center p-4
 *   backdrop + max-w-lg card with close button, no Approve/Make changes.
 */
function ReadOnlyPlanModal({
  domains,
  approach,
  onClose,
}: {
  domains: Array<string | { domain: string; category?: string }>;
  approach: string[];
  onClose: () => void;
}) {
  const t = useUi();

  // Official eS isReadOnly: Escape closes (non-capture).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      role="dialog"
      aria-modal
      aria-label={t.claudePlanTitle}
    >
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
      <div className="relative max-w-lg w-full">
        <div className="bg-bg-000 rounded-[14px]">
          <div className="flex items-center justify-between py-[10px] px-4">
            <div className="flex items-center gap-2">
              <ListChecks size={20} className="text-text-100" />
              <h3 className="font-base text-text-100">{t.claudePlanTitle}</h3>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="text-text-400 hover:text-text-200 transition-colors duration-200 p-1 rounded-md hover:bg-bg-200"
              aria-label={t.decline}
            >
              <CloseIcon size={16} />
            </button>
          </div>
          <div className="border-t border-border-300" />
          <div className="px-4 py-3 space-y-4 max-h-[40vh] overflow-y-auto">
            {domains.length > 0 ? (
              <div>
                <p className="font-small text-text-400 mb-2">{t.planAllowSites}</p>
                <div className="space-y-2">
                  {domains.map((entry, idx) => (
                    <div
                      key={`${domainLabel(entry)}-${idx}`}
                      className="flex items-start gap-2"
                    >
                      <span className="flex-shrink-0 w-5 h-5 flex items-center justify-center">
                        <Globe size={16} className="text-text-400" />
                      </span>
                      <span className="font-base text-text-100" dir="ltr">
                        {domainLabel(entry)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
            {approach.length > 0 ? (
              <div>
                <p className="font-small text-text-400 mb-2">{t.planApproach}</p>
                <div className="space-y-2">
                  {approach.map((step, idx) => (
                    <div key={idx} className="flex items-start gap-2">
                      <span className="flex-shrink-0 w-5 h-5 rounded-full border-border-300 border-0.5 flex items-center justify-center text-xs text-text-400">
                        {idx + 1}
                      </span>
                      <span className="font-base text-text-100" dir="ltr">
                        {step}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Official YC: browser_batch stream row ──────────────────────────────────

type BatchStepStatus = 'running' | 'ok' | 'error';

interface BatchStep {
  index: number;
  name: string;
  input: Record<string, unknown>;
  status: BatchStepStatus;
  error?: string;
}

/**
 * Build per-action steps for YC.
 * Official uses live progress store; we derive from input.actions + final result.
 * While running: all steps show as running (no mid-batch progress events yet).
 * On finish: parse output lines `[i/total] label` / FAILED, or mark all ok / last error.
 */
function buildBatchSteps(item: ToolItem): BatchStep[] {
  const args = (item.input ?? {}) as { actions?: unknown };
  const actions = Array.isArray(args.actions) ? args.actions : [];
  const total = actions.length;

  const base: BatchStep[] = actions.map((raw, index) => {
    const a = (raw ?? {}) as { name?: unknown; input?: unknown };
    return {
      index,
      name: typeof a.name === 'string' && a.name ? a.name : '?',
      input:
        a.input && typeof a.input === 'object'
          ? (a.input as Record<string, unknown>)
          : {},
      status: 'running' as const,
    };
  });

  if (item.status === 'running' || !item.result) {
    return base;
  }

  // Parse step log lines produced by batch.ts: `[1/N] label` or `… FAILED: …`
  const log = item.result.output ?? '';
  const failedIdx = (() => {
    const m = (item.result.error ?? '').match(/actions\[(\d+)\]/);
    return m ? Number(m[1]) : -1;
  })();

  const completedFromLog = new Set<number>();
  for (const line of log.split('\n')) {
    const m = line.match(/^\[(\d+)\/(\d+)\]\s+/);
    if (!m) continue;
    const i = Number(m[1]) - 1;
    if (i >= 0 && i < total) completedFromLog.add(i);
  }

  return base.map((step, i) => {
    if (item.status === 'error' && failedIdx >= 0) {
      if (i < failedIdx) return { ...step, status: 'ok' as const };
      if (i === failedIdx) {
        return {
          ...step,
          status: 'error' as const,
          error: item.result?.error,
        };
      }
      return { ...step, status: 'running' as const }; // not run — leave neutral? official marks remaining not shown as error
    }
    if (item.status === 'error' && failedIdx < 0) {
      // Unknown which step failed — mark all completed-from-log ok, last as error if any
      if (completedFromLog.has(i) && !/FAILED/i.test(log.split('\n').find((l) => l.startsWith(`[${i + 1}/`)) ?? '')) {
        return { ...step, status: 'ok' as const };
      }
      // Heuristic: last line with FAILED
      const failLine = log
        .split('\n')
        .find((l) => l.startsWith(`[${i + 1}/`) && /FAILED/i.test(l));
      if (failLine) {
        return { ...step, status: 'error' as const, error: failLine };
      }
      if (completedFromLog.has(i)) return { ...step, status: 'ok' as const };
      return step;
    }
    // ok
    return { ...step, status: 'ok' as const };
  });
}

/**
 * Official YC — browser_batch:
 *   Ji collapsible row, icon ss (Layers) size 12
 *   text: "Batch — {completed}/{total} actions"
 *   secondaryText on error: "Stopped on error"
 *   children: JC rows — status glyph + tool icon + describeCall label
 */
function BatchToolRow({
  item,
  embedded,
  isFirst,
  isLast,
}: {
  item: ToolItem;
  embedded: boolean;
  isFirst: boolean;
  isLast: boolean;
}) {
  const t = useUi();
  const steps = useMemo(() => buildBatchSteps(item), [item]);
  const total = steps.length;
  const completed = steps.filter((s) => s.status !== 'running').length;
  const running = item.status === 'running';
  const hasError =
    item.status === 'error' || steps.some((s) => s.status === 'error');
  // Official YC defaults isExpanded=true
  const [expanded, setExpanded] = useState(true);

  const label = t.batchActions(completed, total);

  const iconEl = (
    <div className="flex items-center justify-center text-text-500 shrink-0">
      <Layers size={12} className="text-text-500" />
    </div>
  );

  const rowBtn = (
    <button
      type="button"
      onClick={() => setExpanded((v) => !v)}
      aria-expanded={expanded}
      className={cn(
        'group/row flex flex-row items-center rounded-lg px-2.5 w-full justify-between',
        !embedded && 'py-2',
        'text-text-300 cursor-pointer transition-colors duration-200 hover:text-text-200 hover:text-text-000',
      )}
    >
      <div className="flex flex-row items-center gap-2 min-w-0 flex-1">
        {!embedded ? iconEl : null}
        <div
          className={cn(
            'text-body text-text-500 text-left truncate w-0 flex-grow',
            running && 'shimmertext',
          )}
        >
          {label}
        </div>
      </div>
      <div className="flex flex-row items-center gap-1.5 shrink-0">
        {hasError ? (
          <span className="text-danger-100 font-small whitespace-nowrap">
            {t.batchStoppedOnError}
          </span>
        ) : null}
        <span
          className={cn(
            'inline-flex transition-transform',
            expanded ? 'rotate-180' : 'rotate-0',
          )}
        >
          <CaretDown className="text-text-300" size={16} />
        </span>
      </div>
    </button>
  );

  const detail = expanded ? (
    <div className="flex flex-col gap-0.5 px-2 pb-2">
      {steps.map((step) => (
        <BatchStepRow
          key={step.index}
          step={step}
          parentRunning={running}
        />
      ))}
    </div>
  ) : null;

  if (embedded) {
    return (
      <TimelineGroupItem
        icon={iconEl}
        header={rowBtn}
        isExpanded={Boolean(detail)}
        isFirstItem={isFirst}
        isLastItem={isLast}
        isActive={running && isLast}
        showDotFallback={false}
      >
        {detail}
      </TimelineGroupItem>
    );
  }

  return (
    <div
      className={cn(
        'ease-out rounded-lg border-[0.5px] flex flex-col font-ui leading-normal my-3 border-border-300',
        !expanded && 'hover:bg-bg-200',
        expanded && 'bg-bg-000 shadow-sm',
      )}
    >
      {rowBtn}
      {detail}
    </div>
  );
}

/** Official JC nested batch action row. */
function BatchStepRow({
  step,
  parentRunning,
}: {
  step: BatchStep;
  parentRunning: boolean;
}) {
  const t = useUi();
  const { Icon, label } = describeCall(step.name, step.input, t);
  // Live running → pulse; finished batch but step never ran → empty dot (no pulse).
  const live = step.status === 'running' && parentRunning;
  const skipped = step.status === 'running' && !parentRunning;
  const statusGlyph =
    step.status === 'ok' ? (
      <CheckIcon size={12} className="text-text-500" />
    ) : step.status === 'error' ? (
      <CloseIcon size={12} className="text-danger-100" />
    ) : live ? (
      <span className="inline-block h-3 w-3 animate-pulse rounded-full bg-text-500/50" />
    ) : (
      <span className="inline-block h-3 w-3 rounded-full bg-border-300" />
    );

  const err =
    step.error && step.error.length > 60
      ? `${step.error.slice(0, 60)}…`
      : step.error;

  return (
    <div className="flex flex-row items-center gap-2 rounded-md px-2 py-1 text-sm text-text-500">
      <span className="flex h-3 w-3 shrink-0 items-center justify-center">
        {statusGlyph}
      </span>
      <span className="flex h-3 w-3 shrink-0 items-center justify-center text-text-300">
        <Icon size={12} className="text-text-300" />
      </span>
      <span
        className={cn(
          'min-w-0 flex-1 truncate text-left',
          live && 'shimmertext',
          skipped && 'text-text-500/70',
        )}
      >
        {label}
      </span>
      {step.status === 'error' && err ? (
        <span
          className="shrink-0 truncate text-danger-100 max-w-[40%]"
          title={step.error}
        >
          {err}
        </span>
      ) : null}
    </div>
  );
}
