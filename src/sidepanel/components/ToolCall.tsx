/**
 * 工具调用行 — className 对齐官方 ToolUseRow / TimelineGroupItem
 * （sidepanel-CEYFzMrx.js Yi / Gi）。
 *
 * Standard 外壳:
 *   ease-out rounded-lg border-[0.5px] flex flex-col font-ui leading-normal
 *   my-3 border-border-300 (+ hover / expanded bg)
 *
 * TimelineGroup (embedded) 走 Gi 时间轴：
 *   左轨 w-[20px] + 1px border 线 + icon/dot
 *   行按钮 group/row …（Timeline 模式不在行内再放 icon）
 */

import { useState } from 'react';
import { CaretDown, CheckIcon, CloseIcon, SpinnerIcon } from './icons';
import { cn } from './cn';
import { describeCall } from '../toolDisplay';
import type { ToolItem } from '../state/transcript';

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
  const { Icon, label } = describeCall(item.name, item.input);
  const [expanded, setExpanded] = useState(item.status === 'error');

  const duration =
    item.endedAt !== undefined ? ((item.endedAt - item.startedAt) / 1000).toFixed(1) : null;
  const running = item.status === 'running';

  const iconEl = (
    <div className="flex items-center justify-center text-text-500 shrink-0">
      {running ? (
        <SpinnerIcon size={16} className="animate-spin text-text-400" />
      ) : item.status === 'error' ? (
        <CloseIcon size={16} className="text-danger-100" />
      ) : (
        <Icon size={16} className="text-text-500" />
      )}
    </div>
  );

  // Official Yi row button (k). TimelineGroup: no left icon in row, py often omitted.
  const rowBtn = (
    <button
      type="button"
      onClick={() => setExpanded((v) => !v)}
      aria-expanded={expanded}
      className={cn(
        'group/row flex flex-row items-center rounded-lg px-2.5 w-full justify-between',
        !embedded && 'py-2',
        embedded && 'py-1',
        'text-text-300 cursor-pointer transition-colors duration-200 hover:text-text-200',
      )}
    >
      <div className="flex flex-row items-center gap-2 min-w-0 flex-1">
        {/* Standard only — TimelineGroup puts icon on the rail */}
        {!embedded ? iconEl : null}
        <div
          className={cn(
            // Official Yi: text-body text-text-500 text-left truncate + w-0 flex-grow
            'text-left truncate w-0 flex-grow text-text-500 text-sm',
            item.status === 'error' && 'text-danger-100',
            // Official: a ? qi({children:i}) : i  — running label uses qi shimmer
            running && 'shimmertext',
          )}
        >
          {label}
        </div>
      </div>

      <div className="flex flex-row items-center gap-1.5 shrink-0">
        {duration && item.status !== 'running' ? (
          <p className="pl-1 text-text-500 font-small shrink-0 whitespace-nowrap">{duration}s</p>
        ) : null}
        {!embedded ? <StatusMark item={item} /> : null}
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

  const detail = expanded ? <ToolDetail item={item} /> : null;

  if (embedded) {
    // Official: m===TimelineGroup → Gi({ icon, header: row, children: detail, … })
    return (
      <TimelineGroupItem
        icon={iconEl}
        header={rowBtn}
        isExpanded={expanded}
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
        // Official Yi Standard shell (mt-3/mb-3; no doubled my-3)
        'ease-out rounded-lg border-[0.5px] flex flex-col font-ui leading-normal border-border-300 mt-3 mb-3',
        !expanded && 'hover:bg-bg-200',
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
          isExpanded && 'bg-bg-000',
          // Subtle active pulse for live tail (official isActive)
          isActive && 'bg-bg-000/40',
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
      {/* Official expanded body: mx-2.5 mt-1 mb-2 max-h-[200px] bg-bg-000/50 */}
      <div className="border-[0.5px] border-border-300 rounded-lg mx-2.5 mt-1 mb-2 max-h-[200px] overflow-y-auto bg-bg-000/50">
        <div className="p-2 flex flex-col gap-2 [&_pre]:!text-xs [&_code]:!text-xs">
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
