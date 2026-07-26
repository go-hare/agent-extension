/**
 * 用户 / 助手消息气泡。
 *
 * ⚠️ 这里的 className 串是从原版 1.0.81 的 `assets/sidepanel-CEYFzMrx.js`
 * **逐字**抄下来的，不要"顺手优化"。几个容易抄错的点：
 *
 *  - 用户消息是 `px-4 py-3 bg-bg-300 rounded-[14px]`
 *    —— 不是 bg-bg-200，也不是 rounded-xl（rounded-xl = 12px，原版是 14px）。
 *  - 助手消息**完全没有气泡/背景**，只有 `max-w-4xl claude-response w-full break-words`。
 *    本项目把 `claude-response` 改名成 `agent-response`（同一份 CSS 定义），
 *    这是唯一有意的偏差 —— 类名带产品名不合适。
 *  - 折叠阈值 500 字符、折叠高度 300px、渐变 `from-bg-300`、
 *    展开按钮 `border-[0.5px] border-[hsl(var(--border-400)/0.5)]`，均同原版。
 */

import { useState } from 'react';
import { cn } from './cn';
import { Markdown } from './Markdown';
import { CaretDown, CaretUp } from './icons';
import type { AssistantTextItem, UserItem } from '../state/transcript';

/** 原版用的就是 500。 */
const COLLAPSE_AT = 500;

export function UserMessage({ item }: { item: UserItem }) {
  const [expanded, setExpanded] = useState(false);
  const long = item.text.length > COLLAPSE_AT;

  return (
    <div className="group flex justify-end">
      <div className="relative inline-flex flex-col break-words max-w-full">
        <div
          className={cn(
            'relative transition-all duration-300 ease-in-out',
            'ml-auto px-4 py-3 bg-bg-300 rounded-[14px]',
            long && !expanded && 'max-h-[300px] overflow-hidden',
            long && expanded && 'max-h-[50000px] overflow-hidden',
          )}
        >
          {/*
            whitespace-pre-wrap：用户输入的换行是有意义的，不能被 HTML 折叠掉。
            这里**不过 Markdown** —— 用户没要求渲染，而且渲染自己的输入
            会让 `*` `_` 这类字符神秘消失。原版同样只用 font-base 直出。
          */}
          <div className="font-base whitespace-pre-wrap text-sm text-text-100">{item.text}</div>

          {long && !expanded ? (
            <div className="absolute bottom-0 left-0 right-0 h-16 bg-gradient-to-t from-bg-300 to-transparent pointer-events-none transition-opacity duration-300" />
          ) : null}
        </div>

        {long ? (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            aria-label={expanded ? 'Collapse message' : 'Expand message'}
            className="absolute bottom-0.5 right-0 p-1.5 bg-bg-500 hover:bg-bg-200 rounded-full transition-colors border-[0.5px] border-[hsl(var(--border-400)/0.5)] opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto"
          >
            {expanded ? (
              <CaretUp size={12} className="text-text-200" />
            ) : (
              <CaretDown size={12} className="text-text-200" />
            )}
          </button>
        ) : null}
      </div>
    </div>
  );
}

export function AssistantMessage({ item }: { item: AssistantTextItem }) {
  return (
    <div className="flex items-start group">
      <div className="max-w-4xl agent-response w-full break-words">
        {/*
          原版的行内文本变体：
          font-claude-response text-sm leading-[1.65rem] text-text-100
          [&_a]:!underline [&_a]:text-brand-100 [&_p]:!text-sm [&_p]:text-text-100
          [&_ul]:text-sm [&_ol]:text-sm
        */}
        <div className="font-agent-response text-sm leading-[1.65rem] text-text-100 [&_a]:!underline [&_a]:text-brand-100 [&_p]:!text-sm [&_p]:text-text-100 [&_ul]:text-sm [&_ol]:text-sm">
          <Markdown text={item.text} />
          {/* 流式光标。inline-block + 固定尺寸，避免行高抖动。 */}
          {item.streaming ? (
            <span className="ml-0.5 inline-block h-[0.9em] w-[2px] translate-y-[0.1em] animate-pulse bg-text-300 align-middle" />
          ) : null}
        </div>
      </div>
    </div>
  );
}
