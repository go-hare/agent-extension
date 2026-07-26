/**
 * 输入框。
 *
 * 用 TipTap 而不是 <textarea>，和原版一致。理由不是"想要富文本" ——
 * 恰恰相反，这里**禁掉了几乎所有富文本节点**。真正的理由有三条：
 *
 *  1. **自动高度**。textarea 想跟着内容长高只能靠 JS 量 scrollHeight 再回写，
 *     每帧都会触发一次强制同步布局；contenteditable 天生就是自适应的。
 *  2. **粘贴净化**。用户从网页复制一段带样式的文字粘进来，textarea 会带进
 *     一堆不可见字符和换行；TipTap 的 schema 会把它规约成纯段落。
 *  3. **Enter / Shift+Enter 的区分**在 contenteditable 里是一个 keymap 扩展，
 *     不需要自己拦 keydown 再手动插 \n 和维护光标。
 *
 * className 串逐字取自原版 `assets/sidepanel-CEYFzMrx.js`：
 *   容器阴影三态（默认 / hover / focus-within）、按钮 h-7 w-7 rounded-lg、
 *   `data-chat-input-container="true"`、`data-test-id="send-button|stop-button"`。
 *
 * 权限模式文案对齐原版：
 *   Ask before acting — "Claude plans its approach before taking actions."
 *   Act without asking — "Claude works without pausing for approval."
 * 切到 skip 时先弹 SkipConfirm（原版 HZ）。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { Placeholder } from '@tiptap/extensions';
import { cn } from './cn';
import { CaretDown, CheckIcon, SendIcon, StopIcon } from './icons';
import { SkipConfirm } from './SkipConfirm';
import type { Settings } from '@/shared/types';

/** 原版的轮播占位符文案与间隔。 */
const ROTATING = ['How can I help you today?', 'Type / for commands'];
const ROTATE_MS = 3000;

export interface SlashCommand {
  id: string;
  label: string;
  description: string;
  /** 插入到输入框的文本；为空时表示该命令直接执行副作用 */
  insert?: string;
  run?: () => void;
}

export interface ComposerProps {
  /** 有历史消息时占位符不再轮播，固定成 "Reply to the agent"。 */
  empty: boolean;
  running: boolean;
  /** 有权限气泡在等回答 —— 此时 loop 挂起，不能再发新消息。 */
  blocked: boolean;
  permissionMode: Settings['permissionMode'];
  onPermissionModeChange: (mode: Settings['permissionMode']) => void;
  onSend: (text: string) => void;
  onStop: () => void;
  /** `/` 命令菜单项（clear / settings / summarize…） */
  commands: SlashCommand[];
}

export function Composer({
  empty,
  running,
  blocked,
  permissionMode,
  onPermissionModeChange,
  onSend,
  onStop,
  commands,
}: ComposerProps) {
  const [text, setText] = useState('');
  const [rotation, setRotation] = useState(0);
  const [modeOpen, setModeOpen] = useState(false);
  const [slashOpen, setSlashOpen] = useState(false);
  const [slashQuery, setSlashQuery] = useState('');
  const [slashIndex, setSlashIndex] = useState(0);
  const [skipConfirmOpen, setSkipConfirmOpen] = useState(false);
  const modeRef = useRef<HTMLDivElement>(null);

  // 占位符只在"空对话 + 没在跑"时轮播。跑起来之后再换字会让人以为
  // 输入框状态变了。
  const rotating = empty && !running && !blocked;

  useEffect(() => {
    if (!rotating) return;
    const t = window.setInterval(() => setRotation((i) => (i + 1) % ROTATING.length), ROTATE_MS);
    return () => window.clearInterval(t);
  }, [rotating]);

  const placeholder = useMemo(() => {
    if (blocked) return 'Answer the permission request above';
    if (!empty) return 'Reply to the agent';
    return ROTATING[rotation] ?? ROTATING[0];
  }, [blocked, empty, rotation]);

  const disabled = running || blocked;

  const submit = useCallback(
    (value: string) => {
      const trimmed = value.trim();
      if (!trimmed) return false;
      // 斜杠命令：有 run 且无 insert → 本地副作用；有 insert → 展开成提示再发。
      // 避免用户手敲 `/summarize` 回车时，把字面量发给模型。
      if (trimmed.startsWith('/')) {
        const name = trimmed.slice(1).split(/\s+/)[0]?.toLowerCase() ?? '';
        const cmd = commands.find((c) => c.id === name || c.label.toLowerCase() === name);
        if (cmd) {
          if (cmd.run && !cmd.insert) {
            cmd.run();
            return true;
          }
          if (cmd.insert) {
            onSend(cmd.insert);
            return true;
          }
        }
      }
      onSend(trimmed);
      return true;
    },
    [onSend, commands],
  );

  const filteredCommands = useMemo(() => {
    const q = slashQuery.toLowerCase();
    if (!q) return commands;
    return commands.filter(
      (c) => c.id.includes(q) || c.label.toLowerCase().includes(q) || c.description.toLowerCase().includes(q),
    );
  }, [commands, slashQuery]);

  const editor = useEditor({
    /*
     * 只留段落和换行。
     *
     * 关掉标题/列表/引用/代码块不是偷懒 —— 输入框里的这些结构最终都会被
     * getText() 拍平成纯文本发给模型，留着只会让用户以为格式会保留。
     * link 也关掉：粘贴 URL 时自动变成 <a> 会在 getText() 里丢掉 href。
     */
    extensions: [
      StarterKit.configure({
        heading: false,
        bulletList: false,
        orderedList: false,
        listItem: false,
        listKeymap: false,
        blockquote: false,
        codeBlock: false,
        horizontalRule: false,
        link: false,
      }),
      Placeholder.configure({
        emptyEditorClass: 'is-editor-empty',
        placeholder: () => placeholder,
      }),
    ],
    editorProps: {
      attributes: {
        // `tiptap` class：原版 placeholder 选择器是 `.tiptap p.is-editor-empty:before`
        class:
          'tiptap w-full resize-none focus:outline-none focus:ring-0 focus:border-transparent text-text-100 overflow-y-auto text-sm max-w-none',
        style: 'min-height: 24px; max-height: 50vh; outline: none;',
        'aria-label': 'Message',
      },
      handleKeyDown(_view, event) {
        // Shift+Enter = 换行，交给 TipTap 默认行为。
        if (event.key !== 'Enter' || event.shiftKey) return false;
        // 输入法组字中的回车是"选词"，不是"发送"。
        // event.isComposing 在部分中文 IME 上不可靠，所以两个都查。
        if (event.isComposing || event.keyCode === 229) return false;
        event.preventDefault();
        return true; // 真正的发送在 onUpdate 之外处理，见下面的 useEffect
      },
    },
    onUpdate({ editor: e }) {
      const next = e.getText();
      setText(next);
      // 以 `/` 开头且没有空格 → 打开斜杠菜单
      const m = next.match(/^\/([^\s]*)$/);
      if (m) {
        setSlashOpen(true);
        setSlashQuery(m[1] ?? '');
        setSlashIndex(0);
      } else {
        setSlashOpen(false);
        setSlashQuery('');
      }
    },
    immediatelyRender: true,
  });

  // TipTap 的 handleKeyDown 拿不到最新的 submit 闭包（它在 useEditor 里被
  // 捕获一次就固定了），所以发送逻辑放在这里，用 DOM 事件补一刀。
  useEffect(() => {
    const dom = editor?.view.dom;
    if (!dom) return;

    const onKeyDown = (event: KeyboardEvent) => {
      // 斜杠菜单导航
      if (slashOpen && filteredCommands.length > 0) {
        if (event.key === 'ArrowDown') {
          event.preventDefault();
          setSlashIndex((i) => (i + 1) % filteredCommands.length);
          return;
        }
        if (event.key === 'ArrowUp') {
          event.preventDefault();
          setSlashIndex((i) => (i - 1 + filteredCommands.length) % filteredCommands.length);
          return;
        }
        if (event.key === 'Escape') {
          event.preventDefault();
          setSlashOpen(false);
          return;
        }
        if (event.key === 'Enter' && !event.shiftKey) {
          event.preventDefault();
          applyCommand(filteredCommands[slashIndex]);
          return;
        }
        if (event.key === 'Tab') {
          event.preventDefault();
          applyCommand(filteredCommands[slashIndex]);
          return;
        }
      }

      if (event.key !== 'Enter' || event.shiftKey) return;
      if (event.isComposing || event.keyCode === 229) return;
      event.preventDefault();
      if (disabled) return;
      if (submit(editor.getText())) editor.commands.clearContent(true);
    };

    const applyCommand = (cmd: SlashCommand | undefined) => {
      if (!cmd || !editor) return;
      setSlashOpen(false);
      if (cmd.run && !cmd.insert) {
        editor.commands.clearContent(true);
        setText('');
        cmd.run();
        return;
      }
      const insert = cmd.insert ?? `/${cmd.id} `;
      editor.commands.setContent(insert);
      setText(insert);
      editor.commands.focus('end');
    };

    dom.addEventListener('keydown', onKeyDown);
    return () => dom.removeEventListener('keydown', onKeyDown);
  }, [editor, disabled, submit, slashOpen, filteredCommands, slashIndex]);

  // placeholder 是 configure 时捕获的闭包，轮播换字后要主动重绘一次。
  useEffect(() => {
    editor?.view.dispatch(editor.state.tr);
  }, [editor, placeholder]);

  // 权限气泡消失后把焦点还给输入框，用户不用再点一下。
  useEffect(() => {
    if (!disabled) editor?.commands.focus();
  }, [editor, disabled]);

  // 点菜单外关闭权限模式下拉
  useEffect(() => {
    if (!modeOpen) return;
    const onDown = (e: MouseEvent) => {
      if (!modeRef.current?.contains(e.target as Node)) setModeOpen(false);
    };
    document.addEventListener('mousedown', onDown, true);
    return () => document.removeEventListener('mousedown', onDown, true);
  }, [modeOpen]);

  const onClickSend = () => {
    if (!editor || disabled) return;
    if (submit(editor.getText())) editor.commands.clearContent(true);
  };

  const pickSlash = (cmd: SlashCommand) => {
    if (!editor) return;
    setSlashOpen(false);
    if (cmd.run && !cmd.insert) {
      editor.commands.clearContent(true);
      setText('');
      cmd.run();
      return;
    }
    const insert = cmd.insert ?? `/${cmd.id} `;
    editor.commands.setContent(insert);
    setText(insert);
    editor.commands.focus('end');
  };

  /** 切模式：ask 直接生效；skip 先二次确认。 */
  const requestModeChange = (mode: Settings['permissionMode']) => {
    setModeOpen(false);
    if (mode === permissionMode) return;
    if (mode === 'skip') {
      setSkipConfirmOpen(true);
      return;
    }
    onPermissionModeChange('ask');
  };

  const confirmSkip = () => {
    setSkipConfirmOpen(false);
    onPermissionModeChange('skip');
  };

  const hasText = text.trim().length > 0;
  const modeLabel = permissionMode === 'skip' ? 'Act without asking' : 'Ask before acting';
  // 原版 skip 模式下发送键变成金色，作为「免确认」的视觉提示。
  const sendBtnClass =
    permissionMode === 'skip'
      ? 'inline-flex items-center justify-center relative shrink-0 select-none disabled:pointer-events-none disabled:opacity-50 disabled:shadow-none disabled:drop-shadow-none font-medium transition-colors h-7 w-7 rounded-lg active:scale-95 bg-[#BF8534] hover:bg-[#A06F2C] text-white'
      : 'inline-flex items-center justify-center relative shrink-0 select-none disabled:pointer-events-none disabled:opacity-50 disabled:shadow-none disabled:drop-shadow-none font-medium transition-colors h-7 w-7 rounded-lg active:scale-95 bg-brand-000 hover:bg-brand-200 text-oncolor-100';

  return (
    <>
      <div className="px-3 md:px-2">
        <div
          data-chat-input-container="true"
          onClick={() => editor?.commands.focus()}
          className="bg-bg-000 rounded-2xl relative z-30 transition-all focus-within:outline-none cursor-text shadow-[0_0.25rem_1.25rem_hsl(var(--always-black)/3.5%),0_0_0_0.5px_hsla(var(--border-300)/0.15)] hover:shadow-[0_0.25rem_1.25rem_hsl(var(--always-black)/3.5%),0_0_0_0.5px_hsla(var(--border-200)/0.3)] focus-within:shadow-[0_0.25rem_1.25rem_hsl(var(--always-black)/7.5%),0_0_0_0.5px_hsla(var(--border-200)/0.3)]"
        >
          {/* 斜杠命令菜单 */}
          {slashOpen && filteredCommands.length > 0 ? (
            <div
              role="listbox"
              className="absolute left-0 right-0 bottom-full mb-1 mx-0 z-40 max-h-64 overflow-y-auto rounded-xl border-[0.5px] border-border-300 bg-bg-000 py-1 shadow-[0_0.25rem_1.25rem_hsl(var(--always-black)/7.5%)]"
            >
              {filteredCommands.map((cmd, i) => (
                <button
                  key={cmd.id}
                  type="button"
                  role="option"
                  aria-selected={i === slashIndex}
                  onMouseEnter={() => setSlashIndex(i)}
                  onClick={() => pickSlash(cmd)}
                  className={cn(
                    'flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left transition-colors',
                    i === slashIndex ? 'bg-bg-200' : 'hover:bg-bg-100',
                  )}
                >
                  <span className="font-base text-sm text-text-100">/{cmd.id}</span>
                  <span className="font-small text-[0.75rem] text-text-500">{cmd.description}</span>
                </button>
              ))}
            </div>
          ) : null}

          <div className="px-4 pt-4 pb-2">
            <div className="relative">
              <EditorContent editor={editor} />
            </div>
          </div>

          <div className="flex items-center justify-between px-3 pb-3 relative">
            <div className="flex items-center gap-2" ref={modeRef}>
              {/*
                权限模式切换 —— 原版文案：
                  "Ask before acting" / "Act without asking"
                skip 不是关掉权限系统：不可逆动作、敏感站、JS、plan 仍会弹气泡。
              */}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setModeOpen((v) => !v);
                }}
                className="hide-focus-ring flex items-center gap-1 rounded-md px-1.5 py-1 font-small text-[0.6875rem] text-text-500 transition-colors hover:bg-bg-200 hover:text-text-300"
                aria-haspopup="listbox"
                aria-expanded={modeOpen}
                aria-label={`Permission mode: ${modeLabel}`}
              >
                <span>{modeLabel}</span>
                <CaretDown size={10} />
              </button>

              {modeOpen ? (
                <div
                  role="listbox"
                  className="absolute left-3 bottom-full mb-1 z-50 w-[280px] rounded-lg border-[0.5px] border-border-300 bg-bg-000 py-1 shadow-[0_0.25rem_1.25rem_hsl(var(--always-black)/7.5%)]"
                >
                  <ModeOption
                    selected={permissionMode === 'ask'}
                    title="Ask before acting"
                    description="Claude plans its approach before taking actions."
                    onClick={() => requestModeChange('ask')}
                  />
                  <ModeOption
                    selected={permissionMode === 'skip'}
                    title="Act without asking"
                    description="Claude works without pausing for approval."
                    onClick={() => requestModeChange('skip')}
                  />
                </div>
              ) : null}
            </div>

            <div className="flex items-center gap-2">
              {running ? (
                <button
                  type="button"
                  data-test-id="stop-button"
                  aria-label="Stop message"
                  onClick={onStop}
                  className="inline-flex items-center justify-center relative shrink-0 select-none font-medium h-7 w-7 rounded-lg active:scale-95 text-text-300 hover:text-text-200 hover:bg-bg-200 transition-colors"
                >
                  <StopIcon size={16} />
                </button>
              ) : (
                <button
                  type="button"
                  data-test-id="send-button"
                  aria-label="Send message"
                  disabled={!hasText || disabled}
                  onClick={onClickSend}
                  className={sendBtnClass}
                >
                  <SendIcon size={16} className="transition-colors" />
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      <SkipConfirm
        open={skipConfirmOpen}
        onCancel={() => setSkipConfirmOpen(false)}
        onConfirm={confirmSkip}
      />
    </>
  );
}

function ModeOption({
  selected,
  title,
  description,
  onClick,
}: {
  selected: boolean;
  title: string;
  description: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      onClick={onClick}
      className={cn(
        'flex w-full items-start gap-2 px-3 py-2 text-left transition-colors',
        selected ? 'bg-bg-200' : 'hover:bg-bg-100',
      )}
    >
      <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center">
        {selected ? <CheckIcon size={12} className="text-text-100" /> : null}
      </span>
      <span className="min-w-0">
        <span className="block font-base text-sm text-text-100">{title}</span>
        <span className="block font-small text-[0.75rem] text-text-500">{description}</span>
      </span>
    </button>
  );
}

/** 状态条。running 时显示在输入框上方。 */
export function StatusLine({ label, steps }: { label: string; steps: number }) {
  return (
    <div className={cn('flex items-center gap-2 px-4 pb-1.5')}>
      <span className="text-sm italic font-agent-response relative inline-block mb-1 status-shimmer">
        {label}
      </span>
      {steps > 0 ? (
        <span className="font-small text-[0.6875rem] text-text-500 mb-1">
          {steps} {steps === 1 ? 'step' : 'steps'}
        </span>
      ) : null}
    </div>
  );
}
