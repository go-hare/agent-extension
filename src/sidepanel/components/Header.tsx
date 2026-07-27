/**
 * 侧栏头部：模型选择 + 清空 + 菜单。
 *
 * 布局 className 逐字取自原版：
 *   外层  flex justify-between items-center px-4 pt-3 pb-3
 *   左侧  flex items-center gap-3
 *   右侧  flex items-center gap-2.5
 *   图标按钮  p-1.5 rounded-md transition-colors text-text-300 hover:bg-bg-300 hover:text-text-100
 *
 * 菜单对齐原版：Settings / Language 子菜单 / Keyboard shortcut。
 */

import { useEffect, useRef, useState } from 'react';
import { cn } from './cn';
import { CaretDown, CheckIcon, MenuIcon, NewChatIcon } from './icons';
import { useUi } from '@/i18n/UiLocaleContext';
import { UI_LOCALES, type UiLocale } from '@/i18n/ui';

export interface HeaderProps {
  model: string;
  availableModels: string[];
  locale: UiLocale | string;
  /** 当前锚定的页面标题，鼠标悬停时给用户确认 agent 在看哪一页 */
  tabTitle?: string;
  tabUrl?: string;
  canClear: boolean;
  onClear: () => void;
  onOpenOptions: () => void;
  onSelectModel: (model: string) => void;
  onSelectLocale: (locale: UiLocale) => void;
  onOpenCowork?: () => void;
  onOpenPairing?: () => void;
}

export function Header({
  model,
  availableModels,
  locale,
  tabTitle,
  tabUrl,
  canClear,
  onClear,
  onOpenOptions,
  onSelectModel,
  onSelectLocale,
  onOpenCowork,
  onOpenPairing,
}: HeaderProps) {
  const t = useUi();

  return (
    <div className="flex justify-between items-center px-4 pt-3 pb-3">
      <div className="flex items-center gap-3 min-w-0">
        <ModelPicker
          model={model}
          availableModels={availableModels}
          onSelect={onSelectModel}
          onOpenOptions={onOpenOptions}
        />

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
        <IconButton label={t.clearChat} disabled={!canClear} onClick={onClear}>
          <NewChatIcon size={12} />
        </IconButton>

        <Menu
          locale={locale}
          onOpenOptions={onOpenOptions}
          onSelectLocale={onSelectLocale}
          onOpenCowork={onOpenCowork}
          onOpenPairing={onOpenPairing}
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

  return (
    <div ref={ref} className="relative min-w-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={t.modelSelectorAria(model)}
        aria-haspopup="listbox"
        aria-expanded={open}
        title={model ? `${model} — click to change` : 'No model selected — click to configure'}
        className="hide-focus-ring flex items-center gap-1 pl-1 pr-1 py-1.5 text-text-200 rounded-md transition-colors hover:bg-bg-300 cursor-pointer"
      >
        <span className="font-ui-serif text-sm truncate">
          {model || t.chooseModel}
        </span>
        <CaretDown size={12} className="shrink-0" />
      </button>

      {open ? (
        <div
          role="listbox"
          className="absolute left-0 top-full mt-1 w-[260px] z-50 max-h-72 overflow-y-auto rounded-lg border-[0.5px] border-border-300 bg-bg-000 py-1 shadow-[0_0.25rem_1.25rem_hsl(var(--always-black)/7.5%)]"
        >
          {options.length === 0 ? (
            <div className="px-3 py-2 font-small text-sm text-text-500">{t.noModelsYet}</div>
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
 * 溢出菜单：Settings / Language / Keyboard shortcut（对齐原版）。
 */
function Menu({
  locale,
  onOpenOptions,
  onSelectLocale,
  onOpenCowork,
  onOpenPairing,
}: {
  locale: UiLocale | string;
  onOpenOptions: () => void;
  onSelectLocale: (locale: UiLocale) => void;
  onOpenCowork?: () => void;
  onOpenPairing?: () => void;
}) {
  const t = useUi();
  const [open, setOpen] = useState(false);
  const [langOpen, setLangOpen] = useState(false);
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
      if (e.key === 'Escape') setOpen(false);
    };

    document.addEventListener('mousedown', onDown, true);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown, true);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <IconButton label={t.menu} onClick={() => setOpen((v) => !v)}>
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
            {t.settings}
          </MenuItem>

          <div className="relative">
            <button
              type="button"
              role="menuitem"
              aria-haspopup="menu"
              aria-expanded={langOpen}
              onClick={() => setLangOpen((v) => !v)}
              className="font-base flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-sm text-text-100 transition-colors hover:bg-bg-200"
            >
              <span>{t.language}</span>
              <CaretDown
                size={12}
                className={cn(
                  'text-text-300 transition-transform',
                  langOpen ? 'rotate-180' : '-rotate-90',
                )}
              />
            </button>
            {langOpen ? (
              <div
                role="menu"
                className="font-base absolute right-full top-0 mr-1 !min-w-44 max-h-72 overflow-y-auto rounded-lg border-[0.5px] border-border-300 bg-bg-000 py-1 shadow-[0_0.25rem_1.25rem_hsl(var(--always-black)/7.5%)]"
              >
                {UI_LOCALES.map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    role="menuitemradio"
                    aria-checked={locale === opt.id}
                    onClick={() => {
                      onSelectLocale(opt.id);
                      setOpen(false);
                      setLangOpen(false);
                    }}
                    className={cn(
                      'flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm transition-colors',
                      locale === opt.id
                        ? 'bg-bg-200 text-text-100'
                        : 'text-text-100 hover:bg-bg-100',
                    )}
                  >
                    <span className="flex h-4 w-4 shrink-0 items-center justify-center">
                      {locale === opt.id ? <CheckIcon size={12} /> : null}
                    </span>
                    <span>{opt.label}</span>
                  </button>
                ))}
              </div>
            ) : null}
          </div>

          <MenuItem
            onClick={() => {
              setOpen(false);
              void chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });
            }}
          >
            {t.keyboardShortcut}
          </MenuItem>

          {onOpenCowork ? (
            <MenuItem
              onClick={() => {
                setOpen(false);
                onOpenCowork();
              }}
            >
              {t.claudeCowork}
            </MenuItem>
          ) : null}

          {onOpenPairing ? (
            <MenuItem
              onClick={() => {
                setOpen(false);
                onOpenPairing();
              }}
            >
              {t.pairingTitle}
            </MenuItem>
          ) : null}
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
