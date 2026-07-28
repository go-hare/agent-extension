/**
 * 会话稿（transcript）—— UI 侧的消息模型。
 *
 * 关键设计：**transcript 和 Anthropic 的 MessageParam[] 是两套东西，各存各的。**
 *
 * 为什么不复用一套：
 *  - API 历史必须严格合法（tool_use 必须配 tool_result、不能有空 content），
 *    是给模型看的；
 *  - UI 需要展示"正在打字""工具跑了 1.2 秒""这次权限被拒了"这类**过程**，
 *    这些东西塞进 API 历史只会浪费 token，还可能让模型困惑。
 *
 * 所以 agent loop 就地追加 MessageParam[]，UI 这边独立消费 AgentEvent 流
 * 构建自己的 transcript。两者靠 toolUseId 对齐。
 */

import type { ToolResult, PermissionRequest, PermissionScope } from '@/shared/types';

export type TranscriptItem =
  | UserItem
  | AssistantTextItem
  | ToolItem
  | PermissionItem
  | NoticeItem;

/** Image/file chips shown on the user bubble (official HumanMessage previews). */
export interface UserAttachment {
  kind: 'image' | 'file';
  id: string;
  name: string;
  mimeType: string;
  /** data URL for image thumbs in the transcript */
  previewUrl?: string;
}

export interface UserItem {
  kind: 'user';
  id: string;
  text: string;
  /** Structured attachments for UI (API still gets base64 image blocks separately). */
  attachments?: UserAttachment[];
  at: number;
}

export interface AssistantTextItem {
  kind: 'text';
  id: string;
  text: string;
  /** 还在流式写入中 */
  streaming: boolean;
  at: number;
}

export interface ToolItem {
  kind: 'tool';
  id: string;
  /** tool_use id，用于和 tool_end / 权限事件对齐 */
  toolUseId: string;
  name: string;
  input: unknown;
  status: 'running' | 'ok' | 'error';
  result?: ToolResult;
  startedAt: number;
  endedAt?: number;
}

export interface PermissionItem {
  kind: 'permission';
  id: string;
  toolUseId: string;
  request: PermissionRequest;
  /** undefined = 还在等用户 */
  answer?: { granted: boolean; scope: PermissionScope };
  at: number;
}

export interface NoticeItem {
  kind: 'notice';
  id: string;
  level: 'info' | 'error';
  text: string;
  at: number;
}

let seq = 0;
export function nextId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${++seq}`;
}

// ─────────────────────── 归约器 ───────────────────────

/**
 * 追加一段助手文本。
 *
 * 流式增量是**逐 delta 到达**的，如果每个 delta 都 push 一个新 item，
 * React 会渲染出成百上千个 <p>。所以这里合并进最后一个仍在 streaming 的
 * text item —— 但只有当它确实是最后一项时才合并：中间要是插了工具调用，
 * 说明模型换了段落，应该开新块（原版也是这个行为）。
 */
export function appendText(items: TranscriptItem[], delta: string): TranscriptItem[] {
  const last = items[items.length - 1];
  if (last && last.kind === 'text' && last.streaming) {
    const merged: AssistantTextItem = { ...last, text: last.text + delta };
    return [...items.slice(0, -1), merged];
  }
  return [
    ...items,
    { kind: 'text', id: nextId('txt'), text: delta, streaming: true, at: Date.now() },
  ];
}

/** 把所有还在 streaming 的文本块封口。turn 结束或出错时调。 */
export function sealStreaming(items: TranscriptItem[]): TranscriptItem[] {
  let changed = false;
  const next = items.map((it) => {
    if (it.kind === 'text' && it.streaming) {
      changed = true;
      return { ...it, streaming: false };
    }
    return it;
  });
  return changed ? next : items;
}

/**
 * 丢掉内容为空的流式文本块。
 *
 * 模型偶尔会在 tool_use 之前发一个空 text block，留着会渲染成一条
 * 高度为 0 但有 margin 的空气泡，看着像 UI 坏了。
 */
export function dropEmptyText(items: TranscriptItem[]): TranscriptItem[] {
  return items.filter((it) => !(it.kind === 'text' && it.text.trim() === ''));
}

export function startTool(
  items: TranscriptItem[],
  toolUseId: string,
  name: string,
  input: unknown,
): TranscriptItem[] {
  return [
    ...sealStreaming(items),
    {
      kind: 'tool',
      id: nextId('tool'),
      toolUseId,
      name,
      input,
      status: 'running',
      startedAt: Date.now(),
    },
  ];
}

export function endTool(
  items: TranscriptItem[],
  toolUseId: string,
  result: ToolResult,
): TranscriptItem[] {
  return items.map((it) =>
    it.kind === 'tool' && it.toolUseId === toolUseId && it.status === 'running'
      ? {
          ...it,
          status: result.error ? ('error' as const) : ('ok' as const),
          result,
          endedAt: Date.now(),
        }
      : it,
  );
}

export function addPermission(
  items: TranscriptItem[],
  request: PermissionRequest,
): TranscriptItem[] {
  return [
    ...items,
    {
      kind: 'permission',
      id: nextId('perm'),
      toolUseId: request.toolUseId,
      request,
      at: Date.now(),
    },
  ];
}

export function resolvePermission(
  items: TranscriptItem[],
  toolUseId: string,
  granted: boolean,
  scope: PermissionScope,
): TranscriptItem[] {
  return items.map((it) =>
    it.kind === 'permission' && it.toolUseId === toolUseId && !it.answer
      ? { ...it, answer: { granted, scope } }
      : it,
  );
}

/**
 * 中断时把所有还悬着的东西收尾。
 *
 * 不做这一步的话，用户点了停止，界面上还会有一个永远转圈的工具行和一个
 * 永远等着的权限气泡 —— 看起来像卡死。
 */
export function settleAll(items: TranscriptItem[], reason: string): TranscriptItem[] {
  return sealStreaming(items).map((it) => {
    if (it.kind === 'tool' && it.status === 'running') {
      return { ...it, status: 'error' as const, result: { error: reason }, endedAt: Date.now() };
    }
    if (it.kind === 'permission' && !it.answer) {
      return { ...it, answer: { granted: false, scope: 'once' as PermissionScope } };
    }
    return it;
  });
}

export function addNotice(
  items: TranscriptItem[],
  level: 'info' | 'error',
  text: string,
): TranscriptItem[] {
  return [
    ...sealStreaming(items),
    { kind: 'notice', id: nextId('note'), level, text, at: Date.now() },
  ];
}
