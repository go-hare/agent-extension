/**
 * 侧栏头部：模型选择 + 清空 + 菜单。
 *
 * 布局 className 逐字取自原版 BZ / FZ：
 *   外层  flex justify-between items-center px-4 pt-3 pb-3
 *   右侧  flex items-center gap-2.5
 *   溢出菜单 w-[240px]：Convert to task / Settings / Language（子菜单）
 */

import { useEffect, useRef, useState } from 'react';
import { cn } from './cn';
import {
  CaretDown,
  CaretRight,
  CheckIcon,
  Clock,
  Globe,
  MenuIcon,
  NewChatIcon,
  SettingsIcon,
  SpinnerIcon,
} from './icons';
import { useUi } from '@/i18n/UiLocaleContext';
import { UI_LOCALES, type UiLocale } from '@/i18n/ui';
import { displayNameFromModelId } from '@/shared/modelDisplay';

export interface HeaderProps {
  model: string;
  availableModels: string[];
  locale: UiLocale | string;
  /** 当前锚定的页面标题（官方 header 不展示 host，保留给菜单/调试用） */
  tabTitle?: string;
  tabUrl?: string;
  canClear: boolean;
  /** Official FZ: disable Convert while agent is running */
  isAgentRunning?: boolean;
  /** Official FZ: has transcript messages (locale change confirm + convert) */
  hasMessages?: boolean;
  onClear: () => void;
  onOpenOptions: () => void;
  onSelectModel: (model: string) => void;
  onSelectLocale: (locale: UiLocale) => void;
  /** Official “Convert to task” (Z7sL1cCQpI) */
  onConvertToTask?: () => void | Promise<void>;
}

export function Header({
  model,
  availableModels,
  locale,
  canClear,
  isAgentRunning = false,
  hasMessages = false,
  onClear,
  onOpenOptions,
  onSelectModel,
  onSelectLocale,
  onConvertToTask,
}: HeaderProps) {
  const t = useUi();

  return (
    <div className="flex justify-between items-center px-4 pt-3 pb-3">
      {/* Official BZ: left = model picker only (no tab host chip) */}
      <div className="flex items-center gap-3 min-w-0">
        <ModelPicker
          model={model}
          availableModels={availableModels}
          onSelect={onSelectModel}
          onOpenOptions={onOpenOptions}
        />
      </div>

      <div className="flex items-center gap-2.5">
        <IconButton label={t.clearChat} disabled={!canClear} onClick={onClear}>
          <NewChatIcon size={12} />
        </IconButton>

        <Menu
          locale={locale}
          hasMessages={hasMessages}
          isAgentRunning={isAgentRunning}
          onOpenOptions={onOpenOptions}
          onSelectLocale={onSelectLocale}
          onConvertToTask={onConvertToTask}
        />
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
  const t = useUi();
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

  const options = Array.from(new Set([...(model ? [model] : []), ...availableModels]));
  const label = displayNameFromModelId(model) || t.chooseModel;
  // Official PZ: single option → plain serif label, no caret / menu
  const canPick = options.length > 1;

  if (!canPick) {
    return (
      <span className="font-ui-serif text-sm text-text-200 pl-1 pr-1 py-1.5 truncate" title={model || undefined}>
        {label}
      </span>
    );
  }

  return (
    <div ref={ref} className="relative min-w-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={t.modelSelectorAria(label)}
        aria-haspopup="listbox"
        aria-expanded={open}
        title={model ? `${label} (${model})` : 'No model selected — click to configure'}
        className="hide-focus-ring flex items-center gap-1 pl-1 pr-1 py-1.5 text-text-200 rounded-md transition-colors hover:bg-bg-300 cursor-pointer"
      >
        <span className="font-ui-serif text-sm truncate">{label}</span>
        <CaretDown size={12} className="shrink-0 text-text-200" />
      </button>

      {open ? (
        <div
          role="listbox"
          className="absolute left-0 top-full mt-1 w-[260px] z-50 max-h-72 overflow-y-auto rounded-lg border-[0.5px] border-border-300 bg-bg-000 py-1 shadow-[0_0.25rem_1.25rem_hsl(var(--always-black)/7.5%)]"
        >
          {options.map((m) => {
            const name = displayNameFromModelId(m) || m;
            return (
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
                  'flex w-full items-start gap-2 px-3 py-1.5 text-left text-sm transition-colors',
                  m === model ? 'bg-bg-200 text-text-100' : 'text-text-100 hover:bg-bg-100',
                )}
              >
                <span className="min-w-0 flex-1">
                  <span className="block font-ui-serif text-text-200 truncate">{name}</span>
                  {name !== m ? (
                    <span className="block font-small text-[0.6875rem] text-text-500 truncate">{m}</span>
                  ) : null}
                </span>
                {m === model ? (
                  <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center text-accent-100">
                    <CheckIcon size={16} />
                  </span>
                ) : null}
              </button>
            );
          })}
          <div className="my-1 border-t border-border-300" />
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              onOpenOptions();
            }}
            className="font-base w-full px-3 py-1.5 text-left text-sm text-text-300 transition-colors hover:bg-bg-100"
          >
            {t.openSettingsEllipsis}
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
        'hide-focus-ring p-1.5 rounded-md transition-colors text-text-300 hover:bg-bg-300 hover:text-text-100',
        disabled && 'opacity-40 pointer-events-none',
      )}
    >
      {children}
    </button>
  );
}

/**
 * 官方 FZ 溢出菜单（Claude in Chrome 1.0.81）：
 *   Convert to task · Settings · Language ▸（子菜单 flyout）
 * 不再挂 Cowork / Pairing —— 官方菜单没有这两项。
 */
function Menu({
  locale,
  hasMessages,
  isAgentRunning,
  onOpenOptions,
  onSelectLocale,
  onConvertToTask,
}: {
  locale: UiLocale | string;
  hasMessages: boolean;
  isAgentRunning: boolean;
  onOpenOptions: () => void;
  onSelectLocale: (locale: UiLocale) => void;
  onConvertToTask?: () => void | Promise<void>;
}) {
  const t = useUi();
  const [open, setOpen] = useState(false);
  const [langOpen, setLangOpen] = useState(false);
  const [converting, setConverting] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) {
      setLangOpen(false);
      return;
    }

    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (langOpen) setLangOpen(false);
        else setOpen(false);
      }
    };

    document.addEventListener('mousedown', onDown, true);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown, true);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, langOpen]);

  const convertDisabled = converting || isAgentRunning || !onConvertToTask || !hasMessages;

  return (
    <div ref={ref} className="relative">
      <IconButton label={t.menu} onClick={() => setOpen((v) => !v)}>
        <MenuIcon size={12} />
      </IconButton>

      {open ? (
        <div
          role="menu"
          className="absolute right-0 top-full mt-1 w-[240px] z-50 rounded-xl border-[0.5px] border-border-300 bg-bg-000 py-1.5 shadow-[0_0.25rem_1.25rem_hsl(var(--always-black)/7.5%)]"
        >
          <MenuItem
            disabled={convertDisabled}
            icon={
              converting ? (
                <SpinnerIcon size={16} className="animate-spin text-text-300" />
              ) : (
                <Clock size={16} className="text-text-300" />
              )
            }
            onClick={() => {
              if (convertDisabled || !onConvertToTask) return;
              setConverting(true);
              void Promise.resolve(onConvertToTask())
                .catch(() => undefined)
                .finally(() => {
                  setConverting(false);
                  setOpen(false);
                });
            }}
          >
            {converting ? t.convertingToTask : t.convertToTask}
          </MenuItem>

          <MenuItem
            icon={<SettingsIcon size={16} className="text-text-300" />}
            onClick={() => {
              setOpen(false);
              onOpenOptions();
            }}
          >
            {t.settings}
          </MenuItem>

          {/* Language row + flyout submenu (official: caret right, left-aligned panel) */}
          <div className="relative">
            <button
              type="button"
              role="menuitem"
              aria-haspopup="menu"
              aria-expanded={langOpen}
              onClick={() => setLangOpen((v) => !v)}
              className={cn(
                'font-base flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-text-100 transition-colors',
                langOpen ? 'bg-bg-200' : 'hover:bg-bg-200',
              )}
            >
              <span className="flex h-4 w-4 shrink-0 items-center justify-center text-text-300">
                <Globe size={16} />
              </span>
              <span className="flex-1 text-sm">{t.language}</span>
              <CaretRight size={16} className="text-text-300 shrink-0" />
            </button>

            {langOpen ? (
              <div
                role="menu"
                className="language-submenu font-base absolute right-full top-0 mr-1 !min-w-44 max-h-72 overflow-y-auto rounded-xl border-[0.5px] border-border-300 bg-bg-000 py-1.5 shadow-[0_0.25rem_1.25rem_hsl(var(--always-black)/7.5%)] z-[60]"
              >
                {UI_LOCALES.map((opt) => {
                  const selected = locale === opt.id;
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      role="menuitemradio"
                      aria-checked={selected}
                      onClick={() => {
                        if (opt.id !== locale) onSelectLocale(opt.id);
                        setOpen(false);
                        setLangOpen(false);
                      }}
                      className={cn(
                        'flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm transition-colors',
                        selected ? 'bg-bg-200 text-text-100' : 'text-text-100 hover:bg-bg-100',
                      )}
                    >
                      <span className="flex-1 text-sm">{opt.label}</span>
                      {selected ? (
                        <CheckIcon size={14} className="text-accent-200 shrink-0" />
                      ) : (
                        <span className="w-3.5 shrink-0" />
                      )}
                    </button>
                  );
                })}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function MenuItem({
  onClick,
  children,
  icon,
  disabled,
}: {
  onClick: () => void;
  children: React.ReactNode;
  icon?: React.ReactNode;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'font-base flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-text-100 transition-colors',
        disabled ? 'opacity-50 cursor-not-allowed' : 'hover:bg-bg-200',
      )}
    >
      {icon ? (
        <span className="flex h-4 w-4 shrink-0 items-center justify-center">{icon}</span>
      ) : null}
      <span className="text-sm flex-1">{children}</span>
    </button>
  );
}

