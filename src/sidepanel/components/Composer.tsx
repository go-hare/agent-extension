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
import {
  AskModeIcon,
  AttachIcon,
  Camera,
  CaretDown,
  CheckIcon,
  ImageIcon,
  SendIcon,
  SkipModeIcon,
  StopIcon,
  TeachIcon,
  X,
} from './icons';
import { SkipConfirm } from './SkipConfirm';
import type { Settings } from '@/shared/types';
import { putUserImage } from '@/media/catalog';
import type { OutgoingAttachment } from '@/sidepanel/state/useSession';
import { useUi } from '@/i18n/UiLocaleContext';

/** 原版的轮播占位符间隔。 */
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
  onSend: (text: string, attachments?: OutgoingAttachment[]) => void;
  onStop: () => void;
  /** `/` 命令菜单项（clear / settings / summarize…） */
  commands: SlashCommand[];
  /** Open Teach Claude / Record workflow. */
  onTeach?: () => void;
  /** Anchored tab — used by Actions → Take a screenshot */
  tabUrl?: string;
  tabId?: number;
}

/** Official DM: pages where captureVisibleTab is blocked / useless. */
const SCREENSHOT_BLOCKED: RegExp[] = [
  /^chrome:/i,
  /^chrome-extension:/i,
  /^edge:/i,
  /^about:/i,
  /^devtools:/i,
  /^view-source:/i,
  /^https?:\/\/chrome\.google\.com\/webstore/i,
  /^https?:\/\/chromewebstore\.google\.com/i,
];

function canTakeScreenshot(url?: string): boolean {
  if (!url) return false;
  return !SCREENSHOT_BLOCKED.some((re) => re.test(url));
}

const MAX_ATTACH = 5;
const MAX_ATTACH_BYTES = 5 * 1024 * 1024;

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== 'string') {
        reject(new Error('Failed to read file'));
        return;
      }
      const comma = result.indexOf(',');
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });
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
  onTeach,
  tabUrl,
  tabId,
}: ComposerProps) {
  const ui = useUi();
  const [text, setText] = useState('');
  const [rotation, setRotation] = useState(0);
  const [modeOpen, setModeOpen] = useState(false);
  const [actionsOpen, setActionsOpen] = useState(false);
  const [slashOpen, setSlashOpen] = useState(false);
  const [slashQuery, setSlashQuery] = useState('');
  const [slashIndex, setSlashIndex] = useState(0);
  const [skipConfirmOpen, setSkipConfirmOpen] = useState(false);
  const [attachments, setAttachments] = useState<OutgoingAttachment[]>([]);
  const [attachError, setAttachError] = useState<string | null>(null);
  const modeRef = useRef<HTMLDivElement>(null);
  const actionsRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const screenshotOk = canTakeScreenshot(tabUrl);

  const rotatingPlaceholders = useMemo(
    () => [ui.howCanIHelp, ui.typeSlashCommands],
    [ui.howCanIHelp, ui.typeSlashCommands],
  );

  // 占位符只在"空对话 + 没在跑"时轮播。跑起来之后再换字会让人以为
  // 输入框状态变了。
  const rotating = empty && !running && !blocked;

  useEffect(() => {
    if (!rotating) return;
    const timer = window.setInterval(
      () => setRotation((i) => (i + 1) % rotatingPlaceholders.length),
      ROTATE_MS,
    );
    return () => window.clearInterval(timer);
  }, [rotating, rotatingPlaceholders.length]);

  const placeholder = useMemo(() => {
    if (blocked) return ui.answerPermissionAbove;
    if (!empty) return ui.replyToClaude;
    return rotatingPlaceholders[rotation] ?? rotatingPlaceholders[0];
  }, [blocked, empty, rotation, rotatingPlaceholders, ui.answerPermissionAbove, ui.replyToClaude]);

  const disabled = running || blocked;

  const submit = useCallback(
    (value: string) => {
      const trimmed = value.trim();
      const pending = attachments;
      if (!trimmed && pending.length === 0) return false;
      // 斜杠命令：有 run 且无 insert → 本地副作用；有 insert → 展开成提示再发。
      // 避免用户手敲 `/summarize` 回车时，把字面量发给模型。
      if (trimmed.startsWith('/') && pending.length === 0) {
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
      onSend(trimmed, pending.length ? pending : undefined);
      setAttachments([]);
      setAttachError(null);
      return true;
    },
    [onSend, commands, attachments],
  );

  const onPickFiles = useCallback(async (list: FileList | null) => {
    if (!list || list.length === 0) return;
    setAttachError(null);
    const incoming = Array.from(list);
    const next: OutgoingAttachment[] = [];
    let error: string | null = null;

    for (const file of incoming) {
      if (attachments.length + next.length >= MAX_ATTACH) {
        error = `You can attach at most ${MAX_ATTACH} files per message.`;
        break;
      }
      if (file.size > MAX_ATTACH_BYTES) {
        error = `"${file.name}" is larger than 5MB.`;
        continue;
      }
      // Official Actions → "Add an image" only accepts images.
      if (!file.type.startsWith('image/')) {
        error = `"${file.name}" is not an image.`;
        continue;
      }
      try {
        const data = await readFileAsBase64(file);
        const mediaType = (
          file.type === 'image/jpeg' ||
          file.type === 'image/webp' ||
          file.type === 'image/gif' ||
          file.type === 'image/png'
            ? file.type
            : 'image/png'
        ) as 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif';
        const entry = putUserImage({
          data,
          mediaType,
          filename: file.name,
        });
        next.push({
          kind: 'image',
          id: entry.id,
          name: file.name,
          mimeType: mediaType,
          data,
        });
      } catch {
        error = `Could not read "${file.name}".`;
      }
    }

    if (next.length) setAttachments((prev) => [...prev, ...next].slice(0, MAX_ATTACH));
    if (error) setAttachError(error);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, [attachments.length]);

  /** Official DM → Take a screenshot via chrome.tabs.captureVisibleTab. */
  const onTakeScreenshot = useCallback(async () => {
    setActionsOpen(false);
    if (!screenshotOk) {
      setAttachError(ui.screenshotUnavailable);
      return;
    }
    if (attachments.length >= MAX_ATTACH) {
      setAttachError(`You can attach at most ${MAX_ATTACH} files per message.`);
      return;
    }
    setAttachError(null);
    try {
      let dataUrl: string;
      if (typeof tabId === 'number') {
        const tab = await chrome.tabs.get(tabId);
        dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, {
          format: 'png',
        });
      } else {
        dataUrl = await chrome.tabs.captureVisibleTab({ format: 'png' });
      }
      if (!dataUrl || typeof dataUrl !== 'string') {
        throw new Error('empty capture');
      }
      const comma = dataUrl.indexOf(',');
      const data = comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
      const name = `screenshot-${new Date().toISOString().replace(/[:.]/g, '-')}.png`;
      const entry = putUserImage({
        data,
        mediaType: 'image/png',
        filename: name,
      });
      setAttachments((prev) =>
        [
          ...prev,
          {
            kind: 'image' as const,
            id: entry.id,
            name,
            mimeType: 'image/png' as const,
            data,
          },
        ].slice(0, MAX_ATTACH),
      );
    } catch {
      setAttachError(ui.screenshotUnavailable);
    }
  }, [attachments.length, screenshotOk, tabId, ui.screenshotUnavailable]);

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

  useEffect(() => {
    if (!actionsOpen) return;
    const onDown = (e: MouseEvent) => {
      if (!actionsRef.current?.contains(e.target as Node)) setActionsOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setActionsOpen(false);
    };
    document.addEventListener('mousedown', onDown, true);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown, true);
      document.removeEventListener('keydown', onKey);
    };
  }, [actionsOpen]);

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

  const hasText = text.trim().length > 0 || attachments.length > 0;
  const modeLabel = permissionMode === 'skip' ? ui.actWithoutAsking : ui.askBeforeActing;
  const isSkip = permissionMode === 'skip';
  // 原版 skip 模式下发送键变成金色，作为「免确认」的视觉提示。
  const sendBtnClass = isSkip
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
            {attachments.length > 0 ? (
              <div className="mb-2 flex flex-wrap gap-1.5">
                {attachments.map((a) => (
                  <span
                    key={a.id}
                    className="inline-flex max-w-full items-center gap-1 rounded-md border-[0.5px] border-border-300 bg-bg-100 px-2 py-0.5 font-small text-[0.6875rem] text-text-300"
                  >
                    <span className="truncate">{a.kind === 'image' ? 'img' : 'file'} {a.name}</span>
                    <button
                      type="button"
                      aria-label={`Remove ${a.name}`}
                      className="shrink-0 rounded p-0.5 hover:bg-bg-200"
                      onClick={(e) => {
                        e.stopPropagation();
                        setAttachments((prev) => prev.filter((x) => x.id !== a.id));
                      }}
                    >
                      <X size={12} />
                    </button>
                  </span>
                ))}
              </div>
            ) : null}
            {attachError ? (
              <div className="mb-1 font-small text-[0.6875rem] text-danger-000">{attachError}</div>
            ) : null}
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
                className="hide-focus-ring flex items-center gap-1 pl-1 pr-1 py-1.5 text-sm text-text-200 rounded-md transition-colors hover:bg-bg-200 cursor-pointer"
                aria-haspopup="listbox"
                aria-expanded={modeOpen}
                aria-label={ui.permissionModeAria(modeLabel)}
              >
                {/* Official _z: raised hand (ask) / fast-forward (skip) before the label */}
                <div className="w-4 h-4 flex items-center justify-center">
                  {isSkip ? (
                    <SkipModeIcon size={16} className="text-text-300" />
                  ) : (
                    <AskModeIcon size={12} className="text-text-300" />
                  )}
                </div>
                <span className="text-xs">{modeLabel}</span>
                <CaretDown size={12} className="text-text-400" />
              </button>

              {modeOpen ? (
                <div
                  role="listbox"
                  className="absolute left-3 bottom-full mb-1 z-50 w-[280px] rounded-lg border-[0.5px] border-border-300 bg-bg-000 py-1 shadow-[0_0.25rem_1.25rem_hsl(var(--always-black)/7.5%)]"
                >
                  <ModeOption
                    selected={permissionMode === 'ask'}
                    title={ui.askBeforeActing}
                    description={ui.askBeforeActingDesc}
                    icon={<AskModeIcon size={12} className="text-text-300" />}
                    onClick={() => requestModeChange('ask')}
                  />
                  <ModeOption
                    selected={permissionMode === 'skip'}
                    title={ui.actWithoutAsking}
                    description={ui.actWithoutAskingDesc}
                    icon={<SkipModeIcon size={16} className="text-text-300" />}
                    onClick={() => requestModeChange('skip')}
                  />
                </div>
              ) : null}
            </div>

            <div className="flex items-center gap-2">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={(e) => void onPickFiles(e.target.files)}
              />
              {onTeach ? (
                <button
                  type="button"
                  aria-label={ui.teachClaude}
                  disabled={running}
                  title={ui.teachClaude}
                  onClick={(e) => {
                    e.stopPropagation();
                    onTeach();
                  }}
                  className="inline-flex items-center justify-center relative shrink-0 select-none font-medium h-7 w-7 rounded-lg active:scale-95 transition-all duration-200 text-text-300 hover:text-text-200 hover:bg-bg-200 disabled:opacity-50"
                >
                  <TeachIcon size={12} />
                </button>
              ) : null}

              {/* Official DM Actions menu: Take a screenshot · Add an image */}
              <div ref={actionsRef} className="relative">
                <button
                  type="button"
                  aria-label={ui.actions}
                  aria-haspopup="menu"
                  aria-expanded={actionsOpen}
                  disabled={disabled || attachments.length >= MAX_ATTACH}
                  title={ui.actions}
                  onClick={(e) => {
                    e.stopPropagation();
                    setModeOpen(false);
                    setActionsOpen((v) => !v);
                  }}
                  className="hide-focus-ring inline-flex items-center justify-center relative shrink-0 select-none disabled:pointer-events-none disabled:opacity-50 font-medium h-7 w-7 rounded-lg active:scale-95 text-text-300 hover:text-text-200 hover:bg-bg-200 transition-all duration-200"
                >
                  <AttachIcon size={12} />
                </button>
                {actionsOpen ? (
                  <div
                    role="menu"
                    className="absolute right-0 bottom-full mb-1 z-50 min-w-[220px] rounded-xl border-[0.5px] border-border-300 bg-bg-000 py-1.5 shadow-[0_0.25rem_1.25rem_hsl(var(--always-black)/7.5%)]"
                  >
                    <button
                      type="button"
                      role="menuitem"
                      disabled={!screenshotOk}
                      title={screenshotOk ? undefined : ui.screenshotUnavailable}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (!screenshotOk) return;
                        void onTakeScreenshot();
                      }}
                      className={cn(
                        'font-base flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors',
                        screenshotOk
                          ? 'text-text-100 hover:bg-bg-200'
                          : 'cursor-not-allowed text-text-400 opacity-60',
                      )}
                    >
                      <span className="flex h-4 w-4 shrink-0 items-center justify-center">
                        <Camera
                          size={16}
                          className={screenshotOk ? 'text-text-300' : 'text-text-400'}
                        />
                      </span>
                      <span className="flex-1 text-sm">{ui.takeScreenshot}</span>
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      onClick={(e) => {
                        e.stopPropagation();
                        setActionsOpen(false);
                        fileInputRef.current?.click();
                      }}
                      className="font-base flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-text-100 transition-colors hover:bg-bg-200"
                    >
                      <span className="flex h-4 w-4 shrink-0 items-center justify-center">
                        <ImageIcon size={16} className="text-text-300" />
                      </span>
                      <span className="flex-1 text-sm">{ui.addAnImage}</span>
                    </button>
                  </div>
                ) : null}
              </div>

              {running ? (
                <button
                  type="button"
                  data-test-id="stop-button"
                  aria-label={ui.stopMessage}
                  onClick={onStop}
                  className="inline-flex items-center justify-center relative shrink-0 select-none font-medium h-7 w-7 rounded-lg active:scale-95 text-text-300 hover:text-text-200 hover:bg-bg-200 transition-colors"
                >
                  <StopIcon size={16} />
                </button>
              ) : (
                <button
                  type="button"
                  data-test-id="send-button"
                  aria-label={ui.sendMessage}
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
  icon,
  onClick,
}: {
  selected: boolean;
  title: string;
  description: string;
  icon: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      onClick={onClick}
      className={cn(
        'flex w-full items-start gap-2 px-3 py-2 text-left transition-colors !whitespace-normal',
        selected ? 'bg-bg-200' : 'hover:bg-bg-100',
      )}
    >
      {/* Official: mode icon left, check on the right when selected */}
      <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center text-text-300">
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm text-text-200">{title}</span>
        <span className="block text-xs text-text-400 mt-0.5">{description}</span>
      </span>
      {selected ? (
        <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center">
          <CheckIcon size={12} className="text-text-100" />
        </span>
      ) : null}
    </button>
  );
}

/**
 * @deprecated Official Working lives in-transcript (StatusPill / DC), not above the composer.
 * Kept only so old imports don't break; App no longer mounts this.
 */
export function StatusLine({ label, steps }: { label: string; steps: number }) {
  const ui = useUi();
  return (
    <div className="group/status flex items-center gap-2 px-4 pb-1.5 py-1 text-sm">
      <span className="text-sm italic font-claude-response relative inline-block mb-1 shimmertext">
        {label}
      </span>
      {steps > 0 ? (
        <span className="font-small text-text-500 mb-1 shrink-0">
          {steps === 1 ? ui.stepsOne : ui.stepsMany(steps)}
        </span>
      ) : null}
    </div>
  );
}
