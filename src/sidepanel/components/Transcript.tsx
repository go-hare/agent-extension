/**
 * 会话稿滚动区。
 *
 * 容器 className 逐字取自原版：
 *   scroller  "flex-1 " + (empty ? "!overflow-hidden" : "")
 *   inner     h-full
 *   列        mx-auto flex size-full max-w-3xl flex-col md:px-2
 *   正文      flex-1 flex flex-col px-4 max-w-3xl mx-auto w-full pt-1
 *
 * ── Working / steps（对齐原版 DC + StatusPill zC + TimelineGroup sc）──
 * 官方 **不在** sticky composer 上方挂 StatusLine。
 * Working / N steps 在对话流内：StatusPill 可展开，工具行挂在 pill 下。
 * toolTransition:"fadeOnStatus"：进行中 pill 文案是 Working；结束后是 N steps。
 *
 * ── Hide steps ──
 * 连续 ≥3 条 tool 时，组内默认折叠：只露最后 2 条。
 *
 * ── 自动滚动 ──
 * 只在用户**本来就贴着底部**时才跟着流式内容滚。
 */

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { cn } from './cn';
import { AssistantMessage, UserMessage } from './Message';
import { PermissionBubble } from './PermissionBubble';
import { TimelineGroupItem, ToolCall } from './ToolCall';
import { AlertIcon, CaretDown, CheckIcon } from './icons';
import { ClaudeSpark } from './ClaudeSpark';
import type { PermissionScope } from '@/shared/types';
import type { ToolItem, TranscriptItem } from '../state/transcript';
import { useUi } from '@/i18n/UiLocaleContext';

/** 距底部多少像素以内算"贴着底部"。太小的话流式换行会把用户判成已滚开。 */
const STICK_THRESHOLD = 64;

/** 原版 TimelineGroup：≥3 条才出现折叠头，折叠时仍露最后 2 条。 */
const AUTO_COLLAPSE_MIN = 3;
const ALWAYS_VISIBLE_TAIL = 2;

export interface TranscriptProps {
  items: TranscriptItem[];
  onAnswer: (toolUseId: string, granted: boolean, scope: PermissionScope) => void;
  /** Agent loop 进行中 —— 驱动 in-transcript Working StatusPill（官方 DC）。 */
  running?: boolean;
  /** 覆盖 Working 文案（如 Waiting for permission）。 */
  statusText?: string;
  children?: React.ReactNode;
}

export function Transcript({
  items,
  onAnswer,
  running = false,
  statusText,
  children,
}: TranscriptProps) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);
  const t = useUi();

  // 用户滚动时更新"是否贴底"。注意读的是滚动前的状态 ——
  // 这个 handler 在内容增长**之前**触发，正好是我们想要的判断时点。
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;

    const onScroll = () => {
      const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
      stickRef.current = distance <= STICK_THRESHOLD;
    };

    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, []);

  // useLayoutEffect 而不是 useEffect：要在浏览器绘制**之前**滚到位，
  // 否则每个流式 delta 都会先画出"内容超出底部"的一帧再跳回去，肉眼可见地抖。
  useLayoutEffect(() => {
    if (!stickRef.current) return;
    const el = scrollerRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [items, running, statusText]);

  const empty = items.length === 0;

  /**
   * 当前 turn = 最后一条 user 之后的 items。
   * 官方把这一段收成 DC（StatusPill + timeline tools + final text）。
   */
  const { beforeTurn, turnItems } = useMemo(() => splitActiveTurn(items), [items]);

  const turnTools = useMemo(
    () => turnItems.filter((it): it is ToolItem => it.kind === 'tool'),
    [turnItems],
  );
  const turnHasRunningTool = turnTools.some((it) => it.status === 'running');
  const turnIsStreaming = running || turnHasRunningTool;
  const workingLabel = statusText?.trim() || t.working;

  return (
    <div
      ref={scrollerRef}
      className={cn('flex-1 overflow-y-auto', empty && '!overflow-hidden')}
    >
      <div className="h-full">
        <div className="mx-auto flex size-full max-w-3xl flex-col md:px-2">
          {empty ? (
            children
          ) : (
            <div className="flex-1 flex flex-col px-4 max-w-3xl mx-auto w-full pt-1">
              {renderRows(beforeTurn, onAnswer, { running: false })}
              {turnItems.length > 0 || turnIsStreaming ? (
                <AssistantTurn
                  items={turnItems}
                  onAnswer={onAnswer}
                  isStreaming={turnIsStreaming}
                  workingLabel={workingLabel}
                  tools={turnTools}
                />
              ) : null}
              {/* 底部留白：让最后一条消息不会紧贴输入框。 */}
              <div className="h-4 shrink-0" />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** 最后一条 user 消息之后的内容 = 当前 assistant turn。 */
function splitActiveTurn(items: TranscriptItem[]): {
  beforeTurn: TranscriptItem[];
  turnItems: TranscriptItem[];
} {
  let lastUser = -1;
  for (let i = items.length - 1; i >= 0; i -= 1) {
    if (items[i]!.kind === 'user') {
      lastUser = i;
      break;
    }
  }
  if (lastUser < 0) {
    return { beforeTurn: items, turnItems: [] };
  }
  return {
    beforeTurn: items.slice(0, lastUser + 1),
    turnItems: items.slice(lastUser + 1),
  };
}

/**
 * 官方 NM/DC：当前 turn 的 tool timeline + StatusPill + 收尾文本。
 * toolTransition fadeOnStatus：进行中 pill = Working；结束后 = N steps。
 */
function AssistantTurn({
  items,
  onAnswer,
  isStreaming,
  workingLabel,
  tools,
}: {
  items: TranscriptItem[];
  onAnswer: TranscriptProps['onAnswer'];
  isStreaming: boolean;
  workingLabel: string;
  tools: ToolItem[];
}) {
  const t = useUi();
  const [expanded, setExpanded] = useState(false);
  const toolCount = tools.length;
  const hasTools = toolCount > 0;
  const turnIsOver = !isStreaming;

  // 进行中：默认折叠历史 step，只盯着 Working（官方 fadeOnStatus）。
  // 结束后：可展开看完整 timeline；≥3 时默认折叠只露尾 2 条。
  useEffect(() => {
    if (isStreaming) setExpanded(false);
  }, [isStreaming]);

  const pillLabel = isStreaming
    ? workingLabel
    : toolCount === 0
      ? workingLabel
      : toolCount === 1
        ? t.stepOne
        : t.stepsCount(toolCount);

  // 无工具且未在跑：只渲染 turn 内非 tool 行（纯文本回复）。
  if (!hasTools && !isStreaming) {
    return <>{renderRows(items, onAnswer, { running: false })}</>;
  }

  // 把 turn 拆成：前置文本 / 工具块（可多段，被 permission 打断）/ 后置文本
  const segments = segmentTurn(items);

  return (
    <div className="min-w-0">
      {segments.map((seg, idx) => {
        if (seg.kind === 'rows') {
          return (
            <div key={`seg_rows_${idx}`}>
              {seg.items.map((item) => (
                <Row key={item.id} item={item} onAnswer={onAnswer} />
              ))}
            </div>
          );
        }

        // tool segment — only the last tool segment gets the live StatusPill chrome
        const isLastToolSeg = !segments.slice(idx + 1).some((s) => s.kind === 'tools');
        if (!isLastToolSeg) {
          return (
            <TimelineGroup
              key={`seg_tools_${idx}`}
              tools={seg.tools}
              forceExpanded
              borderless={false}
            />
          );
        }

        // Official StatusPill: timeline body only while expanded, OR live tail
        // while Working (fadeOnStatus). After turn ends, collapse to "N steps".
        let body: React.ReactNode = null;
        if (expanded) {
          body = (
            <TimelineGroup
              tools={seg.tools}
              forceExpanded
              borderless
              showDone={turnIsOver}
            />
          );
        } else if (isStreaming) {
          body = (
            <TimelineGroup
              tools={seg.tools}
              forceExpanded
              borderless
              liveTailOnly
            />
          );
        }

        return (
          <div key={`seg_tools_${idx}`} className="min-w-0">
            <StatusPill
              isWorking={isStreaming}
              statusText={pillLabel}
              isExpanded={expanded}
              onToggle={
                hasTools || isStreaming
                  ? () => setExpanded((v) => !v)
                  : undefined
              }
              showSpark={isStreaming}
            >
              {body}
            </StatusPill>
          </div>
        );
      })}

      {/* 还在跑、但尚未产生任何 tool/text：单独一颗 Working pill */}
      {isStreaming && items.length === 0 ? (
        <StatusPill
          isWorking
          statusText={workingLabel}
          isExpanded={false}
          showSpark
        />
      ) : null}
    </div>
  );
}

type TurnSegment =
  | { kind: 'rows'; items: TranscriptItem[] }
  | { kind: 'tools'; tools: ToolItem[] };

function segmentTurn(items: TranscriptItem[]): TurnSegment[] {
  const out: TurnSegment[] = [];
  let i = 0;
  while (i < items.length) {
    const item = items[i]!;
    if (item.kind === 'tool') {
      const tools: ToolItem[] = [];
      while (i < items.length && items[i]!.kind === 'tool') {
        tools.push(items[i]! as ToolItem);
        i += 1;
      }
      out.push({ kind: 'tools', tools });
      continue;
    }
    const rows: TranscriptItem[] = [];
    while (i < items.length && items[i]!.kind !== 'tool') {
      rows.push(items[i]!);
      i += 1;
    }
    out.push({ kind: 'rows', items: rows });
  }
  return out;
}

/**
 * 官方 StatusPill（zC in sidepanel-CEYFzMrx.js）逐字 class：
 *   button: group/status flex items-center gap-2 py-1 text-sm …
 *   spark slot: h-5 w-5, li state=writing className="!w-5 !text-brand-200"
 *   text: qi shimmer (shimmertext 2.25s) while isWorking
 */
function StatusPill({
  isWorking,
  statusText,
  isExpanded = false,
  onToggle,
  showSpark = true,
  children,
}: {
  isWorking: boolean;
  statusText: string;
  isExpanded?: boolean;
  onToggle?: () => void;
  showSpark?: boolean;
  children?: React.ReactNode;
}) {
  const interactive = Boolean(onToggle);
  // Official: I = showSpark && isWorking → spark width 20px
  const spark = showSpark && isWorking;

  return (
    <div className="min-w-0 pb-1">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onToggle}
          disabled={!interactive}
          aria-expanded={interactive ? isExpanded : undefined}
          className={cn(
            // Official O= group/status … cursor-pointer text-left (+ flex-1 min-w-0 on button)
            'group/status flex items-center gap-2 py-1 text-sm transition-colors cursor-pointer text-left min-w-0 flex-1',
            !interactive && 'cursor-default',
            spark
              ? 'text-text-300 hover:text-text-200'
              : 'text-text-500 hover:text-text-300',
          )}
        >
          {/* Official spark width transition 0 ↔ 20px */}
          <div
            className={cn(
              'relative h-5 flex items-center justify-center shrink-0 overflow-hidden',
              'transition-[width,margin-right] duration-150 ease-[cubic-bezier(0.25,0.9,0.3,1)]',
              spark ? 'w-5 mr-0.5' : 'w-0 -mr-2 delay-150',
            )}
            aria-hidden
          >
            <div
              className={cn(
                'pt-1 transition-opacity duration-150',
                spark ? 'opacity-100 delay-150' : 'opacity-0',
              )}
            >
              {/* Official li writing: !w-5 !text-brand-200 + 8-frame sprite */}
              <ClaudeSpark state={spark ? 'writing' : 'static'} className="!w-5" />
            </div>
          </div>

          <span className="inline-flex items-center gap-1 min-w-0">
            {isWorking ? (
              // Official qi: gradient shimmer + text-left truncate (StatusPill passes r)
              <span className="shimmertext text-left truncate">{statusText}</span>
            ) : (
              <span className="truncate">{statusText}</span>
            )}
            {interactive ? (
              <span
                className={cn(
                  // Official trailing caret: collapsed -rotate-90, expanded rotate-0
                  'inline-flex shrink-0 transition-opacity duration-200',
                  'group-hover/status:opacity-100 group-focus-visible/status:opacity-100',
                  isExpanded
                    ? 'rotate-0 opacity-100'
                    : '-rotate-90 opacity-0',
                  isWorking && 'text-text-400',
                )}
              >
                <CaretDown size={12} />
              </span>
            ) : null}
          </span>
        </button>
      </div>

      {/* Official StatusPill: polite live region for screen readers */}
      <span className="sr-only" role="status" aria-live="polite">
        {statusText}
      </span>

      {/* Official: grid 0fr/1fr expand for children */}
      {children ? (
        <div
          className="grid transition-[grid-template-rows] duration-300 ease-out"
          style={{ gridTemplateRows: isExpanded || isWorking ? '1fr' : '0fr' }}
        >
          <div className="overflow-hidden min-w-0">{children}</div>
        </div>
      ) : null}
    </div>
  );
}

/**
 * 把连续 tool 行收成 TimelineGroup；其它 kind 原样渲染。
 * 权限气泡永远打断分组 —— 那是用户必须看到的。
 */
function renderRows(
  items: TranscriptItem[],
  onAnswer: TranscriptProps['onAnswer'],
  _opts?: { running?: boolean },
): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  let i = 0;
  while (i < items.length) {
    const item = items[i]!;

    if (item.kind === 'tool') {
      const start = i;
      const tools: TranscriptItem[] = [];
      while (i < items.length && items[i]!.kind === 'tool') {
        tools.push(items[i]!);
        i += 1;
      }
      out.push(
        <TimelineGroup key={`tg_${items[start]!.id}`} tools={tools as ToolItem[]} />,
      );
      continue;
    }

    out.push(<Row key={item.id} item={item} onAnswer={onAnswer} />);
    i += 1;
  }
  return out;
}

/**
 * 原版 TimelineGroup（sc）：
 *   autoCollapse = length >= 3
 *   expanded 默认 false
 *   折叠时 index < length-2 的条目不渲染
 *   头：Gi + caret + "Hide steps" / "{N} steps"
 *   每步：ToolUseRow renderMode=TimelineGroup → Gi 竖轨
 *   收尾：Done（Gi + check）
 *
 * 挂在 StatusPill 下时 borderless（官方 borderless:!0）。
 */
function TimelineGroup({
  tools,
  forceExpanded = false,
  borderless = false,
  liveTailOnly = false,
  showDone = false,
}: {
  tools: ToolItem[];
  forceExpanded?: boolean;
  borderless?: boolean;
  liveTailOnly?: boolean;
  showDone?: boolean;
}) {
  const t = useUi();
  const [expanded, setExpanded] = useState(false);
  const total = tools.length;
  const collapsible = !forceExpanded && total >= AUTO_COLLAPSE_MIN;
  const collapsedCount = Math.max(0, total - ALWAYS_VISIBLE_TAIL);
  const showHeader = collapsible && collapsedCount > 0 && !borderless;
  const open = forceExpanded || expanded;

  let visible = tools;
  if (liveTailOnly && total > 0) {
    const runningIdx = tools.map((x) => x.status).lastIndexOf('running');
    const start = runningIdx >= 0 ? runningIdx : Math.max(0, total - 1);
    visible = tools.slice(start);
  } else if (collapsible && !open) {
    visible = tools.slice(Math.max(0, total - ALWAYS_VISIBLE_TAIL));
  }

  const doneLabel = t.teachDone || 'Done';

  return (
    <div
      className={cn(
        // Official sc: flex flex-col font-ui leading-normal
        // + optional rounded-lg border-0.5 border-border-300 my-3
        'flex flex-col font-ui leading-normal',
        !borderless && 'rounded-lg border-[0.5px] border-border-300 my-3 mt-3 mb-3',
      )}
    >
      {showHeader ? (
        // Official collapse header is itself a TimelineGroupItem with caret icon
        <TimelineGroupItem
          icon={
            <CaretDown
              size={16}
              className={cn(
                'transition-transform text-text-300',
                open ? 'rotate-0' : 'rotate-180',
              )}
            />
          }
          header={
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              aria-expanded={open}
              className="px-3 py-2 w-full text-left text-sm text-text-300"
            >
              {open
                ? t.hideSteps
                : collapsedCount === 1
                  ? t.stepOne
                  : t.stepsCount(collapsedCount)}
            </button>
          }
          isFirstItem
          isLastItem={false}
          isExpanded={false}
          showDotFallback={false}
          hasCollapseHeader
        />
      ) : null}

      {visible.map((tool, index) => (
        <ToolCall
          key={tool.id}
          item={tool}
          embedded
          isFirst={!showHeader && index === 0}
          isLast={index === visible.length - 1 && !showDone}
        />
      ))}

      {showDone ? (
        // Official Done: Gi + Lt check + "Done" pl-2.5 pt-0.5 text-text-300
        <TimelineGroupItem
          icon={<CheckIcon size={16} className="text-text-500" />}
          header={
            <div
              data-timeline-text=""
              className="pl-2.5 pt-0.5 text-text-300 !font-base text-sm"
            >
              {doneLabel}
            </div>
          }
          isFirstItem={false}
          isLastItem
          isExpanded={false}
          showDotFallback={false}
        />
      ) : null}
    </div>
  );
}

function Row({
  item,
  onAnswer,
}: {
  item: TranscriptItem;
  onAnswer: TranscriptProps['onAnswer'];
}) {
  switch (item.kind) {
    case 'user':
      return (
        <div className="mt-4 mb-1">
          <UserMessage item={item} />
        </div>
      );

    case 'text':
      return (
        <div className="mt-2 mb-1">
          <AssistantMessage item={item} />
        </div>
      );

    case 'tool':
      return <ToolCall item={item} />;

    case 'permission':
      return <PermissionBubble item={item} onAnswer={onAnswer} />;

    case 'notice':
      return <Notice level={item.level} text={item.text} />;
  }
}

/**
 * 系统提示行（错误、超限、被停止）。
 *
 * **纯文本渲染，不过 Markdown。** 这里的文字可能来自 API 错误响应，
 * 而中转站的错误体是攻击者可以影响的（比如一个恶意中转站返回一段
 * markdown 链接）。侧栏是特权上下文，不给它渲染富文本的机会。
 */
function Notice({ level, text }: { level: 'info' | 'error'; text: string }) {
  return (
    <div
      className={cn(
        'my-2 flex items-start gap-2 rounded-lg border-[0.5px] px-3 py-2',
        level === 'error'
          ? 'border-danger-100/40 bg-danger-900/40 text-danger-100'
          : 'border-border-300 bg-bg-200 text-text-300',
      )}
    >
      <AlertIcon size={14} className="mt-0.5 shrink-0" />
      <span className="font-small min-w-0 flex-1 whitespace-pre-wrap break-words text-[0.8125rem]">
        {text}
      </span>
    </div>
  );
}
