/**
 * 配置页入口。
 *
 * 和侧栏共用同一份 theme.css 和主题引导逻辑 —— 配置页跟侧栏的主题不一致
 * 会让人以为打开了别的扩展。
 *
 * Chrome auto-translate / form extensions rewrite text nodes under #root.
 * React 19 then throws NotFoundError on removeChild during commit (often
 * right after Save toggles flash/dirty). That path is frequently *uncaught*
 * by class error boundaries — handle it at createRoot + soft remount.
 */

import '@/styles/theme.css';

import { createRoot, type Root } from 'react-dom/client';
import { Options } from './Options';
import { OptionsErrorBoundary } from './ErrorBoundary';
import { bootstrapTheme } from '@/sidepanel/theme';
import { loadSettings, watchSettings } from '@/storage/settings';

bootstrapTheme();
void loadSettings();
watchSettings();

function lockNoTranslate(): void {
  // Hint for translators / assistive tools that still ignore <html translate="no">.
  try {
    const html = document.documentElement;
    html.lang = html.lang || 'en';
    html.setAttribute('translate', 'no');
    html.classList.add('notranslate');
    document.body?.setAttribute('translate', 'no');
    document.body?.classList.add('notranslate');
    const root = document.getElementById('root');
    if (root) {
      root.setAttribute('translate', 'no');
      root.classList.add('notranslate');
    }
  } catch {
    /* ignore */
  }
}

function isDomRaceError(error: unknown): boolean {
  if (!error) return false;
  const name = error instanceof Error ? error.name : '';
  const message = error instanceof Error ? error.message : String(error);
  return (
    name === 'NotFoundError' ||
    /removeChild|insertBefore|NotFoundError|The node to be removed is not a child/i.test(
      message,
    )
  );
}

lockNoTranslate();

const container = document.getElementById('root');
if (!container) {
  throw new Error('#root is missing from options/index.html');
}

let root: Root | null = null;
let remounting = false;
let remountAttempts = 0;
const MAX_REMOUNTS = 3;

function renderApp(): void {
  lockNoTranslate();
  if (!root) {
    root = createRoot(container!, {
      // React 19: DOM commit races often land here instead of ErrorBoundary.
      onUncaughtError(error, errorInfo) {
        console.error('[options] uncaught', error, errorInfo);
        if (isDomRaceError(error)) scheduleSoftRemount('uncaught');
      },
      onCaughtError(error, errorInfo) {
        console.error('[options] caught', error, errorInfo);
        // Boundary already shows UI; still remount if DOM is poisoned.
        if (isDomRaceError(error)) scheduleSoftRemount('caught');
      },
      onRecoverableError(error, errorInfo) {
        console.warn('[options] recoverable', error, errorInfo);
        if (isDomRaceError(error)) scheduleSoftRemount('recoverable');
      },
    });
  }
  root.render(
    <OptionsErrorBoundary onDomRace={() => scheduleSoftRemount('boundary')}>
      <Options />
    </OptionsErrorBoundary>,
  );
}

function scheduleSoftRemount(reason: string): void {
  if (remounting) return;
  if (remountAttempts >= MAX_REMOUNTS) {
    console.error(
      `[options] DOM race remount limit (${MAX_REMOUNTS}) — full reload. reason=${reason}`,
    );
    window.location.reload();
    return;
  }
  remounting = true;
  remountAttempts += 1;
  console.warn(
    `[options] DOM race (${reason}); soft remount ${remountAttempts}/${MAX_REMOUNTS}`,
  );
  // Defer past the failed commit so React finishes tearing down.
  window.setTimeout(() => {
    try {
      root?.unmount();
    } catch {
      /* tree may already be half-dead */
    }
    root = null;
    try {
      container!.replaceChildren();
    } catch {
      container!.innerHTML = '';
    }
    lockNoTranslate();
    remounting = false;
    renderApp();
  }, 0);
}

// Last-resort: native errors outside React's handlers (rare).
window.addEventListener('error', (ev) => {
  if (isDomRaceError(ev.error ?? ev.message)) {
    ev.preventDefault();
    scheduleSoftRemount('window.error');
  }
});

renderApp();
