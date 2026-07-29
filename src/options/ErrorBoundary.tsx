/**
 * Options-page recovery shell.
 *
 * Chrome translate / password managers can mutate React-owned DOM; React 19
 * then throws NotFoundError: removeChild during commit and unmounts the tree
 * → blank page after Save. Catch render/commit errors and offer reload /
 * soft remount via parent callback.
 */

import { Component, type ErrorInfo, type ReactNode } from 'react';

type Props = {
  children: ReactNode;
  /** Soft remount (preferred over full reload when DOM is poisoned). */
  onDomRace?: () => void;
};
type State = { error: Error | null };

function isDomRaceError(error: Error): boolean {
  return (
    error.name === 'NotFoundError' ||
    /removeChild|insertBefore|NotFoundError|The node to be removed is not a child/i.test(
      error.message,
    )
  );
}

export class OptionsErrorBoundary extends Component<Props, State> {
  state: State = { error: null };
  private autoRemountTimer: number | null = null;

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[options] render crashed', error, info.componentStack);
    if (isDomRaceError(error) && this.props.onDomRace) {
      // Prefer soft remount — keeps storage, avoids blank white screen.
      if (this.autoRemountTimer != null) window.clearTimeout(this.autoRemountTimer);
      this.autoRemountTimer = window.setTimeout(() => {
        this.props.onDomRace?.();
      }, 50);
    }
  }

  componentWillUnmount(): void {
    if (this.autoRemountTimer != null) window.clearTimeout(this.autoRemountTimer);
  }

  private reload = (): void => {
    window.location.reload();
  };

  private dismiss = (): void => {
    this.setState({ error: null });
  };

  render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;

    const isDomRace = isDomRaceError(error);

    // Dom races: show brief shell; soft remount usually fires immediately.
    return (
      <div
        className="mx-auto max-w-lg px-6 py-12 text-text-100 notranslate"
        translate="no"
      >
        <h1 className="font-heading mb-2 text-xl">
          {isDomRace ? 'Page view interrupted' : 'Something went wrong'}
        </h1>
        <p className="font-base mb-4 text-sm text-text-400">
          {isDomRace
            ? 'The browser (often auto-translate or a form extension) changed this page while it was updating — common right after Save. Reloading the view… Settings already written to storage are kept.'
            : error.message}
        </p>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={this.reload}
            className="inline-flex h-9 items-center rounded-lg bg-brand-000 px-4 text-sm font-medium text-oncolor-100"
          >
            Reload page
          </button>
          {isDomRace && this.props.onDomRace ? (
            <button
              type="button"
              onClick={() => this.props.onDomRace?.()}
              className="inline-flex h-9 items-center rounded-lg border-[0.5px] border-border-200 px-3 text-sm text-text-100"
            >
              Retry view
            </button>
          ) : null}
          {!isDomRace ? (
            <button
              type="button"
              onClick={this.dismiss}
              className="inline-flex h-9 items-center rounded-lg border-[0.5px] border-border-200 px-3 text-sm text-text-100"
            >
              Try again
            </button>
          ) : null}
        </div>
        <pre className="font-mono mt-6 max-h-40 overflow-auto rounded-lg bg-bg-000 p-3 text-[0.6875rem] text-text-500">
          {error.name}: {error.message}
        </pre>
      </div>
    );
  }
}
