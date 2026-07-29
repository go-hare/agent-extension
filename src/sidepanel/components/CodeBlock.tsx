/**
 * Fenced code chrome — official-adjacent:
 * language label + "Copy to clipboard" (aCdAsIsVv0) with didCopy feedback.
 */

import { memo, useCallback, useEffect, useState } from 'react';
import { useUi } from '@/i18n/UiLocaleContext';
import { cn } from './cn';
import { HighlightedCode } from './CodeHighlight';
import { CheckIcon } from './icons';

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

/** Compact copy glyph (official uses icon button). */
function CopyGlyph({ className = '' }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="currentColor"
      width="14"
      height="14"
      className={className}
      aria-hidden
    >
      <path d="M7.5 3.5A1.5 1.5 0 0 1 9 2h5.5A1.5 1.5 0 0 1 16 3.5v8A1.5 1.5 0 0 1 14.5 13H13v1.5A1.5 1.5 0 0 1 11.5 16h-6A1.5 1.5 0 0 1 4 14.5v-8A1.5 1.5 0 0 1 5.5 5H7V3.5zm1 1.5H5.5a.5.5 0 0 0-.5.5v8a.5.5 0 0 0 .5.5h6a.5.5 0 0 0 .5-.5V13H9A1.5 1.5 0 0 1 7.5 11.5v-6.5zM9 3.5V11.5a.5.5 0 0 0 .5.5h5a.5.5 0 0 0 .5-.5v-8a.5.5 0 0 0-.5-.5H9.5a.5.5 0 0 0-.5.5z" />
    </svg>
  );
}

export const CodeBlock = memo(function CodeBlock({
  code,
  language,
  className,
}: {
  code: string;
  language?: string;
  className?: string;
}) {
  const t = useUi();
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const id = window.setTimeout(() => setCopied(false), 1800);
    return () => window.clearTimeout(id);
  }, [copied]);

  const onCopy = useCallback(async () => {
    const ok = await writeClipboard(code);
    if (ok) setCopied(true);
  }, [code]);

  const label = language?.trim() || t.codeBlockLabel;

  return (
    <div
      className={cn(
        'group/code my-2 overflow-hidden rounded-lg border-[0.5px] border-border-300 bg-bg-200',
        'md-code-block',
      )}
    >
      <div className="flex items-center justify-between gap-2 border-b-[0.5px] border-border-300/80 px-2.5 py-1">
        <span className="font-mono truncate text-[0.6875rem] uppercase tracking-wide text-text-400">
          {label}
        </span>
        <button
          type="button"
          onClick={() => void onCopy()}
          aria-label={copied ? t.codeCopied : t.copyToClipboard}
          title={copied ? t.codeCopied : t.copyToClipboard}
          className={cn(
            'inline-flex h-6 items-center gap-1 rounded-md px-1.5',
            'text-[0.6875rem] text-text-300 hover:bg-bg-300 hover:text-text-100',
            'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-border-300',
          )}
        >
          {copied ? (
            <>
              <CheckIcon size={14} className="text-success-100" />
              <span className="text-success-100">{t.codeCopied}</span>
            </>
          ) : (
            <>
              <CopyGlyph />
              <span className="hidden sm:inline">{t.copyToClipboard}</span>
            </>
          )}
        </button>
      </div>
      <pre
        className={cn(
          'overflow-x-auto p-2.5 text-[0.813rem] leading-[1.5]',
          className,
        )}
      >
        <HighlightedCode
          code={code}
          language={language}
          className={cn(
            'font-mono whitespace-pre-wrap',
            language ? `language-${language}` : undefined,
          )}
        />
      </pre>
    </div>
  );
});
