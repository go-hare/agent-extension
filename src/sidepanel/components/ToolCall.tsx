/**
 * 工具调用行。
 *
 * 默认**折叠成一行**，点开才显示入参和结果。理由不是省地方，是可读性：
 * 一次 "在 GitHub 上找到那个 PR" 的任务可能有 20 次工具调用，全展开的话
 * 用户根本看不到 agent 到底说了什么。
 *
 * 但**出错的调用默认展开** —— 错误是用户唯一需要立刻行动的信息。
 */

import { useState } from 'react';
import { CaretDown, CaretRight, CheckIcon, CloseIcon, SpinnerIcon } from './icons';
import { cn } from './cn';
import { describeCall } from '../toolDisplay';
import type { ToolItem } from '../state/transcript';

export function ToolCall({ item }: { item: ToolItem }) {
  const { Icon, label } = describeCall(item.name, item.input);
  const [expanded, setExpanded] = useState(item.status === 'error');

  const duration =
    item.endedAt !== undefined ? ((item.endedAt - item.startedAt) / 1000).toFixed(1) : null;

  return (
    <div className="my-0.5">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className={cn(
          'flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors',
          'hover:bg-bg-200',
        )}
        aria-expanded={expanded}
      >
        {expanded ? (
          <CaretDown size={12} className="shrink-0 text-text-400" />
        ) : (
          <CaretRight size={12} className="shrink-0 text-text-400" />
        )}

        <Icon size={14} className="shrink-0 text-text-300" />

        <span
          className={cn(
            'font-small min-w-0 flex-1 truncate text-[0.8125rem]',
            item.status === 'error' ? 'text-danger-100' : 'text-text-200',
          )}
        >
          {label}
        </span>

        <StatusMark item={item} />

        {duration && item.status !== 'running' ? (
          <span className="font-small shrink-0 text-[0.6875rem] text-text-500">{duration}s</span>
        ) : null}
      </button>

      {expanded ? <ToolDetail item={item} /> : null}
    </div>
  );
}

function StatusMark({ item }: { item: ToolItem }) {
  if (item.status === 'running') {
    return <SpinnerIcon size={12} className="shrink-0 animate-spin text-text-400" />;
  }
  if (item.status === 'error') {
    return <CloseIcon size={12} className="shrink-0 text-danger-100" />;
  }
  return <CheckIcon size={12} className="shrink-0 text-success-100" />;
}

function ToolDetail({ item }: { item: ToolItem }) {
  const images = item.result?.images ?? [];

  return (
    <div className="ml-6 mt-1 space-y-2 border-l-[0.5px] border-border-300 pl-3">
      <Block title="Input">
        <Pre text={safeJson(item.input)} />
      </Block>

      {item.result?.error ? (
        <Block title="Error" tone="danger">
          <Pre text={item.result.error} tone="danger" />
        </Block>
      ) : null}

      {item.result?.output ? (
        <Block title="Output">
          {/*
            工具输出可能来自页面（a11y 树、console、网络）。
            **一律当纯文本渲染**，不过 Markdown —— 页面能控制这段内容，
            让它变成可点链接就等于把注入面延伸到侧栏 UI 上。
          */}
          <Pre text={clip(item.result.output)} />
        </Block>
      ) : null}

      {images.length > 0 ? (
        <Block title={images.length === 1 ? 'Screenshot' : `${images.length} screenshots`}>
          <div className="flex flex-col gap-1.5">
            {images.map((img, i) => (
              <img
                key={i}
                src={`data:${img.mediaType};base64,${img.data}`}
                alt="Screenshot sent to the model"
                className="w-full rounded-lg border-[0.5px] border-border-300"
              />
            ))}
          </div>
        </Block>
      ) : null}
    </div>
  );
}

function Block({
  title,
  tone,
  children,
}: {
  title: string;
  tone?: 'danger';
  children: React.ReactNode;
}) {
  return (
    <div>
      <div
        className={cn(
          'font-small-bold mb-1 text-[0.6875rem] uppercase tracking-wide',
          tone === 'danger' ? 'text-danger-100' : 'text-text-400',
        )}
      >
        {title}
      </div>
      {children}
    </div>
  );
}

function Pre({ text, tone }: { text: string; tone?: 'danger' }) {
  return (
    <pre
      className={cn(
        'max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-lg border-[0.5px] border-border-300 bg-bg-200 p-2 font-mono text-[0.6875rem] leading-relaxed',
        tone === 'danger' ? 'text-danger-100' : 'text-text-300',
      )}
    >
      {text}
    </pre>
  );
}

/** 工具输出可能是 50000 字符的 a11y 树；UI 里没必要全放，DOM 会卡。 */
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
