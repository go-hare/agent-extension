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
  /**
   * Official messages paddingBottom:
   *   permissionPromptHeight > 0 ? `${n - 80}px` : '40px'
   * Active permission is sticky overlay — not inline — so the scroller
   * reserves space so the last message is not hidden under it.
   */
  bottomPad?: string | number;
  /**
   * toolUseId of the unanswered permission currently shown in the sticky
   * shell. That item is omitted from the inline stream (official keeps
   * permissionPrompt out of the message list).
   */
  stickyPermissionId?: string | null;
  /**
   * Official sticky shell gets `pr-2` when the messages scroller overflows
   * (stable gutter alignment with scrollbar-gutter:stable).
   */
  onScrollerOverflow?: (overflowing: boolean) => void;
  children?: React.ReactNode;
}

export function Transcript({
  items,
  onAnswer,
  running = false,
  statusText,
  bottomPad = '40px',
  stickyPermissionId = null,
  onScrollerOverflow,
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

  // Official: permission sticky pr-2 when scroller content overflows.
  useLayoutEffect(() => {
    const el = scrollerRef.current;
    if (!el || !onScrollerOverflow) return;

    const measure = () => {
      onScrollerOverflow(el.scrollHeight > el.clientHeight + 1);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    // Also re-check when children grow (scrollHeight changes without resize).
    const mo = new MutationObserver(measure);
    mo.observe(el, { childList: true, subtree: true, characterData: true });
    return () => {
      ro.disconnect();
      mo.disconnect();
    };
  }, [onScrollerOverflow, items, running, bottomPad]);

  // useLayoutEffect 而不是 useEffect：要在浏览器绘制**之前**滚到位，
  // 否则每个流式 delta 都会先画出"内容超出底部"的一帧再跳回去，肉眼可见地抖。
  useLayoutEffect(() => {
    if (!stickRef.current) return;
    const el = scrollerRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [items, running, statusText, bottomPad]);

  const empty = items.length === 0;

  // Unanswered sticky permission is rendered by App — drop it from the stream.
  const visibleItems = useMemo(() => {
    if (!stickyPermissionId) return items;
    return items.filter(
      (it) =>
        !(
          it.kind === 'permission' &&
          it.answer === undefined &&
          (it.toolUseId === stickyPermissionId || it.id === stickyPermissionId)
        ),
    );
  }, [items, stickyPermissionId]);

  /**
   * 当前 turn = 最后一条 user 之后的 items。
   * 官方把这一段收成 DC（StatusPill + timeline tools + final text）。
   */
  const { beforeTurn, turnItems } = useMemo(
    () => splitActiveTurn(visibleItems),
    [visibleItems],
  );

  const turnTools = useMemo(
    () => turnItems.filter((it): it is ToolItem => it.kind === 'tool'),
    [turnItems],
  );
  const turnHasRunningTool = turnTools.some((it) => it.status === 'running');
  const turnIsStreaming = running || turnHasRunningTool;
  const workingLabel = statusText?.trim() || t.working;

  const padStyle = useMemo(() => {
    const pb =
      typeof bottomPad === 'number' ? `${bottomPad}px` : bottomPad || '40px';
    return { paddingBottom: pb } as React.CSSProperties;
  }, [bottomPad]);

  return (
    <div
      ref={scrollerRef}
      // Official AutoScroll scroller:
      //   overflow-y-auto overflow-x-hidden [scrollbar-gutter:stable]
      className={cn(
        'flex-1 overflow-y-auto overflow-x-hidden [scrollbar-gutter:stable]',
        empty && '!overflow-hidden',
      )}
    >
      <div className="h-full">
        <div className="mx-auto flex size-full max-w-3xl flex-col md:px-2">
          {empty ? (
            children
          ) : (
            <div
              className="flex-1 flex flex-col px-4 max-w-3xl mx-auto w-full pt-1"
              style={padStyle}
            >
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
 *
 * 关键：官方 permissionPrompt 不在 message 流里打断 tool 块。
 * 我们若把 answered chip 夹在 tool 之间，会把 timeline 拆成多段，
 * 非最后一段还会带 border（截图里的 Read page / Navigate 两张卡）。
 * 因此 turn 内 **所有 tool 合成一条 borderless TimelineGroup**；
 * permission chip / 文本按「首 tool 前 / 末 tool 后」落位。
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

  // Official DC: Working while streaming; else "{count} steps" over ALL tools
  // in the turn (vAKAnIbJ4M), including 1 → "1 step" / "1 步".
  const pillLabel = isStreaming
    ? workingLabel
    : toolCount === 0
      ? workingLabel
      : toolCount === 1
        ? t.stepsOne
        : t.stepsMany(toolCount);

  // 无工具且未在跑：只渲染 turn 内非 tool 行（纯文本回复）。
  if (!hasTools && !isStreaming) {
    return <>{renderRows(items, onAnswer, { running: false })}</>;
  }

  const { before, after } = splitTurnAroundTools(items);

  // Official DC (fadeOnStatus + trailing caret):
  //  - StatusPill isExpanded = user toggle only (NOT auto while working)
  //  - StatusPill children = full TimelineGroup only when expanded
  //  - Live tool tail while Working is a SIBLING below the pill
  //    (row-start-2 in official grid), never forced into the expand grid
  const expandedBody = expanded ? (
    <TimelineGroup
      tools={tools}
      forceExpanded
      borderless
      showDone={turnIsOver}
    />
  ) : null;

  const liveSibling =
    isStreaming && !expanded && hasTools ? (
      <TimelineGroup
        tools={tools}
        forceExpanded
        borderless
        liveTailOnly
      />
    ) : null;

  return (
    <div className="min-w-0">
      {before.map((item) => (
        <Row key={item.id} item={item} onAnswer={onAnswer} />
      ))}

      {hasTools || isStreaming ? (
        <div className="min-w-0">
          <div className="grid grid-rows-[auto_auto] min-w-0">
            <div className="row-start-1 col-start-1 min-w-0">
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
                {expandedBody}
              </StatusPill>
            </div>
            {liveSibling ? (
              <div className="row-start-2 col-start-1 relative min-w-0">
                {liveSibling}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      {after.map((item) => (
        <Row key={item.id} item={item} onAnswer={onAnswer} />
      ))}

      {/*
        Empty streaming turn (no tools/text yet) is already covered by the
        StatusPill above when `isStreaming` — do NOT mount a second pill
        (screenshot: two "处理中" rows).
      */}
    </div>
  );
}

/**
 * Split turn items around the tool block without letting permission chips
 * (or other non-tools) fracture the timeline into multiple bordered groups.
 * Tools themselves are taken from the `tools` prop; here we only place
 * non-tool rows before the first tool / after the last tool.
 */
function splitTurnAroundTools(items: TranscriptItem[]): {
  before: TranscriptItem[];
  after: TranscriptItem[];
} {
  let firstTool = -1;
  let lastTool = -1;
  for (let i = 0; i < items.length; i += 1) {
    if (items[i]!.kind === 'tool') {
      if (firstTool < 0) firstTool = i;
      lastTool = i;
    }
  }
  if (firstTool < 0) {
    return { before: items.filter((it) => it.kind !== 'tool'), after: [] };
  }
  const before: TranscriptItem[] = [];
  const after: TranscriptItem[] = [];
  for (let i = 0; i < items.length; i += 1) {
    const it = items[i]!;
    if (it.kind === 'tool') continue;
    if (i < firstTool) before.push(it);
    else if (i > lastTool) after.push(it);
    else {
      // Answered permission (or notice) that sat between tools — keep after
      // the continuous timeline so it does not split the rail.
      after.push(it);
    }
  }
  return { before, after };
}

/**
 * 官方 StatusPill（zC in sidepanel-CEYFzMrx.js）逐字 class：
 *   button: group/status flex items-center gap-2 py-1 text-sm …
 *   spark slot: h-5 w-5, li state=writing className="!w-5 !text-brand-200"
 *   text: qi shimmer + textClassName default "font-base"
 *   trailing caret: ALWAYS -rotate-90; opacity-0 → group-hover opacity-100
 *   gridTemplateRows: isExpanded ? 1fr : 0fr  (NOT isWorking)
 *   children kept mounted while expanded OR until 300ms collapse delay ends
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

  // Official: E = delayed hide flag; A = M || !E → keep children during collapse anim
  const [hideChildren, setHideChildren] = useState(!isExpanded);
  useEffect(() => {
    if (isExpanded) {
      setHideChildren(false);
      return;
    }
    const t = window.setTimeout(() => setHideChildren(true), 300);
    return () => window.clearTimeout(t);
  }, [isExpanded]);
  const showBody = isExpanded || !hideChildren;

  return (
    <div className="min-w-0 pb-1">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onToggle}
          disabled={!interactive}
          aria-expanded={interactive ? isExpanded : undefined}
          className={cn(
            // Official O (zC): group/status flex items-center gap-2 py-1 text-sm …
            // + flex-1 min-w-0 on the button when no inline action
            'group/status flex items-center gap-2 py-1 text-sm transition-colors cursor-pointer text-left flex-1 min-w-0',
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
              {/* Official li: state=writing className="!w-5 !text-brand-200" */}
              <ClaudeSpark
                state={spark ? 'writing' : 'static'}
                className="!w-5 !text-brand-200"
              />
            </div>
          </div>

          {/*
            Official L fragment: status text + trailing caret are SIBLINGS
            inside inline-flex gap-1 (caret is NOT nested inside the text span).
            Working → qi shimmer with text-left truncate + font-base.
          */}
          <div className="inline-flex items-center gap-1 min-w-0">
            {isWorking ? (
              <span className="shimmertext font-base text-left truncate">
                {statusText}
              </span>
            ) : (
              <span className="font-base truncate">{statusText}</span>
            )}
            {interactive ? (
              // Official trailing caret: always -rotate-90; opacity only on hover
              <span
                className={cn(
                  'inline-flex -rotate-90 shrink-0 opacity-0 transition-opacity duration-200',
                  'group-hover/status:opacity-100 group-focus-visible/status:opacity-100',
                  isWorking && 'text-text-400',
                )}
              >
                <CaretDown size={12} />
              </span>
            ) : null}
          </div>
        </button>
      </div>

      {/* Official StatusPill: polite live region for screen readers */}
      <span className="sr-only" role="status" aria-live="polite">
        {statusText}
      </span>

      {/*
        Official expand:
          gridTemplateRows: M ? "1fr" : "0fr"
          children: A ? b : null   (A = expanded || !delayedHide)
        Live tool tail is rendered OUTSIDE this grid by AssistantTurn when
        streaming + collapsed — StatusPill itself only expands on isExpanded.
      */}
      {children ? (
        <div
          className="grid transition-[grid-template-rows] duration-300 ease-out"
          style={{ gridTemplateRows: isExpanded ? '1fr' : '0fr' }}
        >
          <div className="overflow-hidden min-w-0">
            {showBody ? children : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

/**
 * 把连续 tool 行收成 **一条** TimelineGroup（官方 NM/DC）。
 *
 * 已答 permission 只是一行 chip，**不打断**工具时间轴——否则每个 tool
 * 会各自变成带边框的独立卡（用户截图里的 Read page / Navigate 两张卡）。
 * 未答 permission 已被 sticky 层滤掉，不会进这里。
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

    if (item.kind === 'tool' || item.kind === 'permission') {
      // Gather a run of tools + answered permission chips; one timeline for tools.
      const start = i;
      const tools: ToolItem[] = [];
      const chips: TranscriptItem[] = [];
      while (i < items.length) {
        const cur = items[i]!;
        if (cur.kind === 'tool') {
          tools.push(cur);
          i += 1;
          continue;
        }
        if (cur.kind === 'permission') {
          chips.push(cur);
          i += 1;
          continue;
        }
        break;
      }
      if (tools.length > 0) {
        out.push(
          <TimelineGroup
            key={`tg_${items[start]!.id}`}
            tools={tools}
            borderless
          />,
        );
      }
      for (const chip of chips) {
        out.push(<Row key={chip.id} item={chip} onAnswer={onAnswer} />);
      }
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

  /**
   * Official DC fadeOnStatus live sibling (`se = e.slice(Q)`):
   *   Q snaps only when statusText changes mid-turn; otherwise Q stays 0
   *   → growing full tool list under Working, not "only the running row".
   * We mirror that: liveTailOnly renders the full segment (growing tail).
   * Collapse mode (non-live) still hides all but the last ALWAYS_VISIBLE_TAIL.
   */
  let visible = tools;
  if (liveTailOnly && total > 0) {
    visible = tools;
  } else if (collapsible && !open) {
    visible = tools.slice(Math.max(0, total - ALWAYS_VISIBLE_TAIL));
  }

  // Official Done row (JXdbo8Vnlw) — not teachDone.
  const doneLabel = t.done;

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
        // Official Done: Gi + Lt check + "Done" pl-2.5 pt-0.5 text-text-300 !font-base
        // (no extra text-sm — !font-base already sets 0.875rem)
        <TimelineGroupItem
          icon={<CheckIcon size={16} className="text-text-500" />}
          header={
            <div
              data-timeline-text=""
              className="pl-2.5 pt-0.5 text-text-300 !font-base"
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
      // Official user blocks sit directly in the column — no invent-ed mt-4 wrapper.
      return <UserMessage item={item} />;

    case 'text':
      // Official assistant text follows tools with StatusPill spacing, not mt-2.
      return <AssistantMessage item={item} />;

    case 'tool':
      return <ToolCall item={item} />;

    case 'permission':
      // Official: unanswered lives in sticky shell (filtered out of stream).
      // Answered permissionPrompt is cleared — only a one-line history chip.
      return (
        <PermissionBubble
          item={item}
          onAnswer={onAnswer}
          compactAnswered
        />
      );

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
