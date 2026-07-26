/**
 * 任务清单（todowrite 工具的 UI）。
 *
 * 模型通过 todowrite 更新，用户只读。不在这里做勾选 ——
 * 勾选会让 transcript 和模型记忆分叉。
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

  return (
    <div className="mx-4 mb-2 rounded-[14px] border-[0.5px] border-border-300 bg-bg-000 px-3 py-2.5">
      <div className="mb-2 flex items-center gap-2">
        <ListChecks size={14} className="text-text-300" />
        <span className="font-base text-sm text-text-100">Plan</span>
        <span className="font-small text-[0.6875rem] text-text-500">
          {done}/{items.length}
        </span>
      </div>
      <ul className="space-y-1.5">
        {items.map((t) => (
          <li key={t.id} className="flex items-start gap-2">
            <StatusDot status={t.status} />
            <span
              className={cn(
                'font-base min-w-0 flex-1 text-[0.8125rem] leading-snug',
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
