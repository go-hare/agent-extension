/**
 * 用户 / 助手消息气泡。
 *
 * ⚠️ 这里的 className 串是从原版 1.0.81 的 `assets/sidepanel-CEYFzMrx.js`
 * **逐字**抄下来的，不要"顺手优化"。几个容易抄错的点：
 *
 *  - 用户消息是 `px-4 py-3 bg-bg-300 rounded-[14px]`
 *    —— 不是 bg-bg-200，也不是 rounded-xl（rounded-xl = 12px，原版是 14px）。
 *  - 助手消息**完全没有气泡/背景**，官方为
 *    `max-w-4xl claude-response w-full break-words` +
 *    `font-claude-response text-sm leading-[1.65rem] …`（逐字）。
 *  - 折叠阈值 500 字符、折叠高度 300px、渐变 `from-bg-300`、
 *    展开按钮 `border-[0.5px] border-[hsl(var(--border-400)/0.5)]`，均同原版。
 *  - Copy message（`8Rj4WgXPcB`）：hover 显示 `p-1.5 rounded-md …` 图标按钮，
 *    复制后 check 12px + “Copied” tooltip 文案。
 *  - 有附件时官方 HumanMessage 在气泡外/内展示图片预览。
 */

import { useCallback, useEffect, useState } from 'react';
import { cn } from './cn';
import { Markdown } from './Markdown';
import { CaretDown, CheckIcon } from './icons';
import { useUi } from '@/i18n/UiLocaleContext';
import type { AssistantTextItem, UserItem } from '../state/transcript';

/** 原版用的就是 500。 */
const COLLAPSE_AT = 500;

async function writeClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through */
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

/** Official `fs` copy glyph (compact 12px). */
function CopyGlyph({ className = '' }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="currentColor"
      width="12"
      height="12"
      className={className}
      aria-hidden
    >
      <path d="M7.5 3.5A1.5 1.5 0 0 1 9 2h5.5A1.5 1.5 0 0 1 16 3.5v8A1.5 1.5 0 0 1 14.5 13H13v1.5A1.5 1.5 0 0 1 11.5 16h-6A1.5 1.5 0 0 1 4 14.5v-8A1.5 1.5 0 0 1 5.5 5H7V3.5zm1 1.5H5.5a.5.5 0 0 0-.5.5v8a.5.5 0 0 0 .5.5h6a.5.5 0 0 0 .5-.5V13H9A1.5 1.5 0 0 1 7.5 11.5v-6.5zM9 3.5V11.5a.5.5 0 0 0 .5.5h5a.5.5 0 0 0 .5-.5v-8a.5.5 0 0 0-.5-.5H9.5a.5.5 0 0 0-.5.5z" />
    </svg>
  );
}

function useCopyFeedback(text: string) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const id = window.setTimeout(() => setCopied(false), 1800);
    return () => window.clearTimeout(id);
  }, [copied]);

  const onCopy = useCallback(async () => {
    const body = text.trim();
    if (!body) return;
    const ok = await writeClipboard(body);
    if (ok) setCopied(true);
  }, [text]);

  return { copied, onCopy, canCopy: text.trim().length > 0 };
}

/** Official message action button classes. */
const COPY_BTN =
  'p-1.5 rounded-md transition-colors text-text-300 hover:bg-bg-300 hover:text-text-100';

function CopyMessageButton({ text }: { text: string }) {
  const t = useUi();
  const { copied, onCopy, canCopy } = useCopyFeedback(text);
  if (!canCopy) return null;
  return (
    <button
      type="button"
      onClick={() => void onCopy()}
      className={COPY_BTN}
      aria-label={t.copyMessage}
      title={copied ? t.copied : t.copy}
    >
      {copied ? <CheckIcon size={12} /> : <CopyGlyph />}
    </button>
  );
}

export function UserMessage({ item }: { item: UserItem }) {
  const [expanded, setExpanded] = useState(false);
  const text = item.text ?? '';
  const long = text.length > COLLAPSE_AT;
  const images = (item.attachments ?? []).filter(
    (a) => a.kind === 'image' && a.previewUrl,
  );
  const files = (item.attachments ?? []).filter((a) => a.kind === 'file');
  const hasBody = text.trim().length > 0 || images.length > 0 || files.length > 0;
  const copyText = [
    text,
    ...files.map((f) => f.name).filter(Boolean),
  ]
    .filter((s) => s.trim().length > 0)
    .join('\n');

  return (
    // Official HumanMessage:
    //   group flex justify-end
    //     flex flex-col items-end max-w-[85%] min-w-0
    //       relative inline-flex flex-col break-words max-w-full
    //         px-4 py-3 bg-bg-300 rounded-[14px]
    //       h-7 flex justify-end — copy on group-hover
    <div className="group flex justify-end">
      <div className="relative flex flex-col items-end max-w-[85%] min-w-0 gap-1.5">
        {images.length > 0 ? (
          <div className="flex flex-wrap justify-end gap-1.5 max-w-full">
            {images.map((img) => (
              <img
                key={img.id}
                src={img.previewUrl}
                alt={img.name || 'Attached image'}
                className="max-w-full max-h-48 rounded-[12px] border-[0.5px] border-border-300 object-contain bg-bg-300"
              />
            ))}
          </div>
        ) : null}

        {hasBody && (text.trim().length > 0 || files.length > 0) ? (
          <div className="relative inline-flex flex-col break-words max-w-full px-4 py-3 bg-bg-300 rounded-[14px]">
            <div
              className={cn(
                'relative transition-all duration-300 ease-in-out',
                long && !expanded && 'max-h-[300px] overflow-hidden',
                long && expanded && 'max-h-[50000px] overflow-hidden',
              )}
            >
              {text.trim().length > 0 ? (
                <div className="font-base whitespace-pre-wrap text-text-100">
                  {text}
                </div>
              ) : null}
              {files.length > 0 ? (
                <div
                  className={cn(
                    'font-small text-text-400 space-y-0.5',
                    text.trim().length > 0 && 'mt-2',
                  )}
                >
                  {files.map((f) => (
                    <div key={f.id}>📎 {f.name}</div>
                  ))}
                </div>
              ) : null}

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
                <span
                  className={cn(
                    'inline-flex transition-transform',
                    expanded && 'rotate-180',
                  )}
                >
                  <CaretDown size={12} className="text-text-300" />
                </span>
              </button>
            ) : null}
          </div>
        ) : null}

        {/* Official user actions: h-7 row, opacity-0 → group-hover */}
        {copyText.trim() ? (
          <div className="h-7 flex justify-end items-center w-full">
            <div className="flex items-center gap-0.5 pr-1 opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto">
              <CopyMessageButton text={copyText} />
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function AssistantMessage({ item }: { item: AssistantTextItem }) {
  const text = item.text ?? '';
  return (
    // Official MM assistant shell:
    //   flex items-start group
    //     max-w-4xl claude-response w-full break-words
    //       font-claude-response …
    //       h-7 actions: opacity-0 group-hover (always show copy when text)
    <div className="flex items-start group">
      <div className="max-w-4xl claude-response w-full break-words">
        <div className="font-claude-response text-sm leading-[1.65rem] text-text-100 [&_a]:!underline [&_a]:text-brand-100 [&_p]:!text-sm [&_p]:text-text-100 [&_ul]:text-sm [&_ol]:text-sm [&_>_*]:min-w-0">
          <Markdown text={text} />
        </div>
        {text.trim() ? (
          <div className="h-7 flex items-center">
            <div className="flex items-center gap-0.5 mt-2 -ml-1.5 opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto">
              <CopyMessageButton text={text} />
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
