/**
 * 工具调用行 — className 对齐官方 ToolUseRow / CollapsibleToolUseRow
 * （sidepanel-CEYFzMrx.js Yi / Ji）。
 *
 * 外壳:
 *   ease-out rounded-lg border-[0.5px] flex flex-col font-ui leading-normal
 *   my-3 border-border-300 (+ hover / expanded bg)
 * 行按钮:
 *   group/row flex flex-row items-center rounded-lg px-2.5 w-full py-2
 *   text-text-300 … hover:text-text-200
 *
 * 默认折叠；出错默认展开。
 */

import { useState } from 'react';
import { CaretDown, CheckIcon, CloseIcon, SpinnerIcon } from './icons';
import { cn } from './cn';
import { describeCall } from '../toolDisplay';
import type { ToolItem } from '../state/transcript';

export function ToolCall({
  item,
  /** TimelineGroup 内嵌时去掉外层卡片边框（官方 renderMode=TimelineGroup） */
  embedded = false,
}: {
  item: ToolItem;
  embedded?: boolean;
}) {
  const { Icon, label } = describeCall(item.name, item.input);
  const [expanded, setExpanded] = useState(item.status === 'error');

  const duration =
    item.endedAt !== undefined ? ((item.endedAt - item.startedAt) / 1000).toFixed(1) : null;
  const running = item.status === 'running';

  const rowBtn = (
    <button
      type="button"
      onClick={() => setExpanded((v) => !v)}
      aria-expanded={expanded}
      className={cn(
        'group/row flex flex-row items-center rounded-lg px-2.5 w-full py-2 justify-between',
        'text-text-300 cursor-pointer transition-colors duration-200 hover:text-text-200',
      )}
    >
      <div className="flex flex-row items-center gap-2 min-w-0 flex-1">
        {!embedded ? (
          <div className="flex items-center justify-center text-text-500 shrink-0">
            <Icon size={16} />
          </div>
        ) : null}
        <div
          className={cn(
            'text-left truncate w-0 flex-grow',
            item.status === 'error' ? 'text-danger-100' : 'text-text-500',
            running && 'status-shimmer',
          )}
        >
          {label}
        </div>
      </div>

      <div className="flex flex-row items-center gap-1.5 shrink-0">
        {duration && item.status !== 'running' ? (
          <p className="pl-1 text-text-500 font-small shrink-0 whitespace-nowrap">{duration}s</p>
        ) : null}
        <StatusMark item={item} />
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

  const body = (
    <>
      {rowBtn}
      {expanded ? <ToolDetail item={item} /> : null}
    </>
  );

  if (embedded) {
    return <div className="w-full">{body}</div>;
  }

  return (
    <div
      className={cn(
        'ease-out rounded-lg border-[0.5px] flex flex-col font-ui leading-normal my-3 border-border-300',
        'mt-3 mb-3',
        !expanded && 'hover:bg-bg-200',
        expanded && 'bg-bg-000 shadow-sm',
      )}
    >
      {body}
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
    <div className="overflow-hidden">
      <div
        onClick={() => {
          /* collapse handled by header */
        }}
        className="rounded-lg border-[0.5px] border-border-300 bg-bg-000 mx-2 mb-2 cursor-default"
      >
        <div className="p-2 flex flex-col gap-2 max-h-[200px] overflow-y-auto [&_pre]:!text-xs [&_code]:!text-xs">
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
                **一律当纯文本渲染**，不过 Markdown。
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
      </div>
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
        'overflow-x-auto whitespace-pre rounded-lg border-0.5 border-border-400 bg-bg-000/50 p-3.5 font-mono text-sm',
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
