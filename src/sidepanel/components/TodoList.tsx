/**
 * 任务清单（todowrite 工具的 UI）。
 *
 * 官方侧栏把 TodoWrite 收成 ToolUseRow 文案 "Step X of Y"；
 * 本扩展额外展示可读清单，边框/字重用官方 token 卡样式
 * （border-[0.5px] border-border-300 rounded-xl / font-base）。
 *
 * 用户只读 — 不在这里勾选，避免 transcript 与模型记忆分叉。
 */

import { cn } from './cn';
import { CheckIcon, ListChecks } from './icons';

export interface TodoItem {
  id: string;
  content: string;
  status: 'pending' | 'in_progress' | 'completed' | 'cancelled';
}

export function TodoList({ items }: { items: TodoItem[] }) {
  if (items.length === 0) return null;

  const done = items.filter((t) => t.status === 'completed').length;
  const current =
    items.findIndex((t) => t.status === 'in_progress' || t.status === 'pending') + 1 || 1;

  return (
    <div className="border-[0.5px] border-border-300 rounded-xl mx-2.5 mt-1 mb-2 overflow-hidden bg-bg-000/30 px-3 py-2 space-y-1.5">
      <div className="flex items-center gap-2">
        <ListChecks size={16} className="text-text-300 shrink-0" />
        <span className="font-base text-text-300 text-sm">
          Step {current} of {items.length}
        </span>
        <span className="font-small text-text-500 ml-auto">
          {done}/{items.length}
        </span>
      </div>
      <ul className="space-y-1.5">
        {items.map((t) => (
          <li key={t.id} className="flex items-start gap-2">
            <StatusDot status={t.status} />
            <span
              className={cn(
                'font-base min-w-0 flex-1 text-sm leading-snug',
                t.status === 'completed' || t.status === 'cancelled'
                  ? 'text-text-500 line-through'
                  : t.status === 'in_progress'
                    ? 'text-text-100'
                    : 'text-text-200',
              )}
            >
              {t.content}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function StatusDot({ status }: { status: TodoItem['status'] }) {
  if (status === 'completed') {
    return (
      <span className="mt-0.5 flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full bg-success-100 text-oncolor-100">
        <CheckIcon size={9} />
      </span>
    );
  }
  if (status === 'in_progress') {
    return (
      <span className="mt-0.5 h-3.5 w-3.5 shrink-0 rounded-full border-2 border-brand-100 bg-brand-100/20" />
    );
  }
  if (status === 'cancelled') {
    return <span className="mt-0.5 h-3.5 w-3.5 shrink-0 rounded-full border border-border-300 bg-bg-200" />;
  }
  return <span className="mt-0.5 h-3.5 w-3.5 shrink-0 rounded-full border border-border-300" />;
}
