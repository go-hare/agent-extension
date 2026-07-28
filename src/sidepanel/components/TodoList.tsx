/**
 * TodoWrite UI — official Claude in Chrome 1.0.81 shows only the tool-row
 * label "Step X of Y" (see sidepanel W()/TodoWrite branch). There is no
 * separate bordered checklist card in the official sidepanel.
 *
 * We keep a tiny non-card strip above the transcript so the user still sees
 * progress without inventing a second UI surface that official never had.
 * The full item list is intentionally NOT rendered (would diverge).
 */

import { ListChecks } from './icons';

export interface TodoItem {
  id: string;
  content: string;
  status: 'pending' | 'in_progress' | 'completed' | 'cancelled';
}

/** Compute official "Step X of Y" numbers from a todo list. */
export function todoStepLabel(items: TodoItem[]): { current: number; total: number } | null {
  if (items.length === 0) return null;
  let current = 1;
  for (let i = 0; i < items.length; i++) {
    const s = items[i]!.status;
    if (s === 'in_progress' || s === 'pending') {
      current = i + 1;
      break;
    }
  }
  return { current, total: items.length };
}

/**
 * Compact Step X of Y chip — not a full checklist card.
 * Mirrors the official TodoWrite tool-row text only.
 */
export function TodoList({ items }: { items: TodoItem[] }) {
  const step = todoStepLabel(items);
  if (!step) return null;

  return (
    <div className="mx-2.5 mt-1 mb-1 flex items-center gap-2 px-1 py-0.5">
      <ListChecks size={16} className="text-text-300 shrink-0" />
      <span className="font-base text-text-300 text-sm">
        Step {step.current} of {step.total}
      </span>
    </div>
  );
}
