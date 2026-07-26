/**
 * 会话稿滚动区。
 *
 * 容器 className 逐字取自原版：
 *   scroller  "flex-1 " + (empty ? "!overflow-hidden" : "")
 *   inner     h-full
 *   列        mx-auto flex size-full max-w-3xl flex-col md:px-2
 *   正文      flex-1 flex flex-col px-4 max-w-3xl mx-auto w-full pt-1
 *
 * 空态那个 `!overflow-hidden` 不是可有可无的：空态里的
 * `justify-center h-full` 会让内容正好等于容器高度，某些缩放比例下
 * 亚像素舍入会多出 1px，滚动条闪一下就消失，看着像 UI 在抖。
 *
 * ── Hide steps（对齐原版 TimelineGroup / sc）──
 * 连续 ≥3 条 tool 时，组内默认折叠：只露最后 2 条，顶部一行
 *   "{N} steps" / "Hide steps"（N = total - 2）
 * 权限气泡 / 错误 / 用户消息打断分组。
 * 展开状态是**组本地**的，不靠 header 全局开关。
 *
 * ── 自动滚动 ──
 * 只在用户**本来就贴着底部**时才跟着流式内容滚。
 */

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { cn } from './cn';
import { AssistantMessage, UserMessage } from './Message';
import { PermissionBubble } from './PermissionBubble';
import { ToolCall } from './ToolCall';
import { AlertIcon, CaretDown } from './icons';
import type { PermissionScope } from '@/shared/types';
import type { TranscriptItem } from '../state/transcript';

/** 距底部多少像素以内算"贴着底部"。太小的话流式换行会把用户判成已滚开。 */
const STICK_THRESHOLD = 64;

/** 原版 TimelineGroup：≥3 条才出现折叠头，折叠时仍露最后 2 条。 */
const AUTO_COLLAPSE_MIN = 3;
const ALWAYS_VISIBLE_TAIL = 2;

export interface TranscriptProps {
  items: TranscriptItem[];
  onAnswer: (toolUseId: string, granted: boolean, scope: PermissionScope) => void;
  children?: React.ReactNode;
}

export function Transcript({ items, onAnswer, children }: TranscriptProps) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);

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
  }, [items]);

  const empty = items.length === 0;

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
              {renderRows(items, onAnswer)}
              {/* 底部留白：让最后一条消息不会紧贴输入框。 */}
              <div className="h-4 shrink-0" />
            </div>
          )}
        </div>
      </div>
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
        <TimelineGroup key={`tg_${items[start]!.id}`} tools={tools} />,
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
 *   头按钮：expanded ? "Hide steps" : "{collapsedCount} step(s)"
 */
function TimelineGroup({ tools }: { tools: TranscriptItem[] }) {
  const [expanded, setExpanded] = useState(false);
  const total = tools.length;
  const collapsible = total >= AUTO_COLLAPSE_MIN;
  const collapsedCount = Math.max(0, total - ALWAYS_VISIBLE_TAIL);
  const showHeader = collapsible && collapsedCount > 0;

  return (
    <div
      className={cn(
        'flex flex-col font-ui leading-normal',
        // 原版用 border-0.5（= 0.5px），不是 border-[0.5px]
        'rounded-lg border-0.5 border-border-300 my-3 mt-3 mb-3',
      )}
    >
      {showHeader ? (
        <div className="flex items-center gap-1">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center">
            <CaretDown
              size={16}
              className={cn(
                'transition-transform text-text-300',
                expanded ? 'rotate-0' : 'rotate-180',
              )}
            />
          </span>
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            aria-expanded={expanded}
            className="px-3 py-2 w-full text-left text-sm text-text-300"
          >
            {expanded
              ? 'Hide steps'
              : collapsedCount === 1
                ? '1 step'
                : `${collapsedCount} steps`}
          </button>
        </div>
      ) : null}

      {tools.map((tool, index) => {
        if (collapsible && !expanded && index < total - ALWAYS_VISIBLE_TAIL) {
          return null;
        }
        return <Row key={tool.id} item={tool} onAnswer={noopAnswer} />;
      })}
    </div>
  );
}

function noopAnswer(_toolUseId: string, _granted: boolean, _scope: PermissionScope): void {
  // tool rows don't use onAnswer
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
