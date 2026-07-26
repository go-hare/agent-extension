/**
 * 侧栏头部：模型选择 + 清空 + 菜单。
 *
 * 布局 className 逐字取自原版：
 *   外层  flex justify-between items-center px-4 pt-3 pb-3
 *   左侧  flex items-center gap-3
 *   右侧  flex items-center gap-2.5
 *   图标按钮  p-1.5 rounded-md transition-colors text-text-300 hover:bg-bg-300 hover:text-text-100
 *
 * Hide steps 在原版里是**工具时间线组内联**按钮，不在 header。
 * 模型选择器是真正的下拉（不是跳配置页）：选项来自 settings.availableModels。
 */

import { useEffect, useRef, useState } from 'react';
import { cn } from './cn';
import { CaretDown, CheckIcon, MenuIcon, NewChatIcon } from './icons';

export interface HeaderProps {
  model: string;
  availableModels: string[];
  /** 当前锚定的页面标题，鼠标悬停时给用户确认 agent 在看哪一页 */
  tabTitle?: string;
  tabUrl?: string;
  canClear: boolean;
  onClear: () => void;
  onOpenOptions: () => void;
  onSelectModel: (model: string) => void;
}

export function Header({
  model,
  availableModels,
  tabTitle,
  tabUrl,
  canClear,
  onClear,
  onOpenOptions,
  onSelectModel,
}: HeaderProps) {
  return (
    <div className="flex justify-between items-center px-4 pt-3 pb-3">
      <div className="flex items-center gap-3 min-w-0">
        <ModelPicker
          model={model}
          availableModels={availableModels}
          onSelect={onSelectModel}
          onOpenOptions={onOpenOptions}
        />

        {/*
          当前页面指示。这不是装饰 —— 侧栏是 per-window 的，用户很容易
          在多标签之间切换后忘了 agent 锚定在哪一页，而工具全都作用在那一页上。
          只显示 hostname：完整 URL 太长，而且 query string 里可能有 token。
        */}
        {tabUrl ? (
          <span
            className="font-small text-[0.6875rem] text-text-500 max-w-[7rem] truncate"
            title={tabTitle ? `${tabTitle}\n${tabUrl}` : tabUrl}
          >
            {hostOf(tabUrl)}
          </span>
        ) : null}
      </div>

      <div className="flex items-center gap-2.5">
        <IconButton label="Clear chat" disabled={!canClear} onClick={onClear}>
          <NewChatIcon size={12} />
        </IconButton>

        <Menu onOpenOptions={onOpenOptions} />
      </div>
    </div>
  );
}

function ModelPicker({
  model,
  availableModels,
  onSelect,
  onOpenOptions,
}: {
  model: string;
  availableModels: string[];
  onSelect: (m: string) => void;
  onOpenOptions: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown, true);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown, true);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  // 当前模型不在列表里时也要显示（用户手填的）
  const options = Array.from(new Set([...(model ? [model] : []), ...availableModels]));

  return (
    <div ref={ref} className="relative min-w-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={`Model selector, ${model || 'no model'} selected`}
        aria-haspopup="listbox"
        aria-expanded={open}
        title={model ? `${model} — click to change` : 'No model selected — click to configure'}
        className="hide-focus-ring flex items-center gap-1 pl-1 pr-1 py-1.5 text-text-200 rounded-md transition-colors hover:bg-bg-300 cursor-pointer max-w-full"
      >
        <span className="font-ui-serif text-sm max-w-[9rem] truncate">
          {model || 'Choose a model'}
        </span>
        <CaretDown size={12} className="shrink-0" />
      </button>

      {open ? (
        <div
          role="listbox"
          className="absolute left-0 top-full mt-1 w-[260px] z-50 max-h-72 overflow-y-auto rounded-lg border-[0.5px] border-border-300 bg-bg-000 py-1 shadow-[0_0.25rem_1.25rem_hsl(var(--always-black)/7.5%)]"
        >
          {options.length === 0 ? (
            <div className="px-3 py-2 font-small text-sm text-text-500">
              No models loaded yet.
            </div>
          ) : (
            options.map((m) => (
              <button
                key={m}
                type="button"
                role="option"
                aria-selected={m === model}
                onClick={() => {
                  onSelect(m);
                  setOpen(false);
                }}
                className={cn(
                  'flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm transition-colors',
                  m === model ? 'bg-bg-200 text-text-100' : 'text-text-100 hover:bg-bg-100',
                )}
              >
                <span className="flex h-4 w-4 shrink-0 items-center justify-center">
                  {m === model ? <CheckIcon size={12} /> : null}
                </span>
                <span className="min-w-0 flex-1 truncate font-base">{m}</span>
              </button>
            ))
          )}
          <div className="my-1 border-t border-border-300" />
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              onOpenOptions();
            }}
            className="font-base w-full px-3 py-1.5 text-left text-sm text-text-300 transition-colors hover:bg-bg-100"
          >
            Open settings…
          </button>
        </div>
      ) : null}
    </div>
  );
}

function IconButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'p-1.5 rounded-md transition-colors text-text-300 hover:bg-bg-300 hover:text-text-100',
        disabled && 'opacity-40 pointer-events-none',
      )}
    >
      {children}
    </button>
  );
}

/**
 * 溢出菜单。
 *
 * 手写而不是用 @radix-ui/react-dropdown-menu：这个菜单只有两项，
 * 而 radix 的 dropdown 会往 document.body 挂 portal 并接管焦点。
 * 侧栏很窄（最小 320px），portal + collision detection 在这个宽度下
 * 经常把菜单顶到视口外面去。两项菜单不值得为它引入这些行为。
 */
function Menu({ onOpenOptions }: { onOpenOptions: () => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };

    // capture 阶段：菜单外的按钮可能自己 stopPropagation，
    // 冒泡阶段监听会漏掉那些点击，菜单就关不掉了。
    document.addEventListener('mousedown', onDown, true);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown, true);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <IconButton label="Menu" onClick={() => setOpen((v) => !v)}>
        <MenuIcon size={12} />
      </IconButton>

      {open ? (
        <div
          role="menu"
          className="absolute right-0 top-full mt-1 w-[240px] z-50 rounded-lg border-[0.5px] border-border-300 bg-bg-000 py-1 shadow-[0_0.25rem_1.25rem_hsl(var(--always-black)/7.5%)]"
        >
          <MenuItem
            onClick={() => {
              setOpen(false);
              onOpenOptions();
            }}
          >
            Settings
          </MenuItem>
          <MenuItem
            onClick={() => {
              setOpen(false);
              void chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });
            }}
          >
            Keyboard shortcut
          </MenuItem>
        </div>
      ) : null}
    </div>
  );
}

function MenuItem({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className="font-base w-full px-3 py-1.5 text-left text-sm text-text-100 transition-colors hover:bg-bg-200"
    >
      {children}
    </button>
  );
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}
