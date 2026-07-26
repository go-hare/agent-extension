/**
 * 侧栏 todo 列表的进程内存储。
 *
 * 不写 chrome.storage：todo 是**当前对话**的进度板，清空对话就该一起清。
 * 工具实现（registry）和 UI（App）都读这个模块，靠 subscribe 推更新。
 */

import type { TodoItem } from '../components/TodoList';

let items: TodoItem[] = [];
const listeners = new Set<(items: TodoItem[]) => void>();

export function getTodos(): TodoItem[] {
  return items;
}

export function setTodos(next: TodoItem[]): void {
  items = next;
  for (const l of listeners) l(items);
}

export function clearTodos(): void {
  setTodos([]);
}

export function subscribeTodos(listener: (items: TodoItem[]) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
