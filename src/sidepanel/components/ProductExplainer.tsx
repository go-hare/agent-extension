/**
 * Honest substitutes for official Cowork iframe + pairing.html.
 * Official Cowork embeds claude.ai; pairing links Desktop ↔ extension.
 * This self-hosted build cannot clone those without OAuth — explain clearly,
 * and for pairing show live native-host / MCP session status (official open MCP).
 *
 * Overlay shell matches official full-screen dialogs:
 *   fixed/absolute inset-0 … bg-bg-100 … p-5
 *   max-w-[520px] + font-claude-response-heading + official CTA buttons
 */

import { useCallback, useEffect, useState } from 'react';
import { useUi } from '@/i18n/UiLocaleContext';

export type ExplainerKind = 'cowork' | 'pairing';

export interface ProductExplainerProps {
  kind: ExplainerKind;
  onClose: () => void;
}

type McpStatus = {
  nativeHostInstalled: boolean;
  mcpConnected: boolean;
  hostName: string | null;
  hostLabel: string | null;
};

function useIsDarkMode(): boolean {
  const [dark, setDark] = useState(() => {
    if (typeof document === 'undefined') return false;
    const mode = document.documentElement.dataset.mode;
    if (mode === 'dark') return true;
    if (mode === 'light') return false;
    return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
  });

  useEffect(() => {
    const el = document.documentElement;
    const read = () => {
      const mode = el.dataset.mode;
      if (mode === 'dark') {
        setDark(true);
        return;
      }
      if (mode === 'light') {
        setDark(false);
        return;
      }
      setDark(window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false);
    };
    read();
    const mo = new MutationObserver(read);
    mo.observe(el, { attributes: true, attributeFilter: ['data-mode'] });
    const mq = window.matchMedia?.('(prefers-color-scheme: dark)');
    const onMq = () => read();
    mq?.addEventListener?.('change', onMq);
    return () => {
      mo.disconnect();
      mq?.removeEventListener?.('change', onMq);
    };
  }, []);

  return dark;
}

export function ProductExplainer({ kind, onClose }: ProductExplainerProps) {
  const t = useUi();
  const isCowork = kind === 'cowork';
  const dark = useIsDarkMode();
  const light = chrome.runtime.getURL(
    isCowork ? 'public/img/cowork_chrome_light.png' : 'public/img/extension-light-min.svg',
  );
  const darkSrc = chrome.runtime.getURL(
    isCowork ? 'public/img/cowork_chrome_dark.png' : 'public/img/extension-dark-min.svg',
  );

  const [mcp, setMcp] = useState<McpStatus | null>(null);
  const [mcpBusy, setMcpBusy] = useState(false);

  const refreshMcp = useCallback(async () => {
    setMcpBusy(true);
    try {
      const res = (await chrome.runtime.sendMessage({
        type: 'check_native_host_status',
      })) as { ok?: boolean; status?: McpStatus } | undefined;
      if (res?.status) setMcp(res.status);
    } catch {
      /* SW waking */
    } finally {
      setMcpBusy(false);
    }
  }, []);

  const reconnectMcp = useCallback(async () => {
    setMcpBusy(true);
    try {
      const res = (await chrome.runtime.sendMessage({
        type: 'reconnect_native_host',
      })) as { ok?: boolean; status?: McpStatus } | undefined;
      if (res?.status) setMcp(res.status);
      else await refreshMcp();
    } catch {
      await refreshMcp();
    } finally {
      setMcpBusy(false);
    }
  }, [refreshMcp]);

  useEffect(() => {
    if (kind !== 'pairing') return;
    void refreshMcp();
  }, [kind, refreshMcp]);

  return (
    <div className="absolute inset-0 z-50 w-full h-screen bg-bg-100 flex items-center justify-center p-5">
      <div className="max-w-[520px] w-full" role="dialog" aria-modal="true">
        <div className="flex justify-center mb-4">
          <img
            src={dark ? darkSrc : light}
            alt=""
            className="w-[240px] h-[140px] object-contain rounded-[14px]"
          />
        </div>

        <h2 className="font-claude-response-heading text-center text-text-100 mb-3">
          {isCowork ? t.coworkUnavailableTitle : t.pairingTitle}
        </h2>
        <p className="font-base text-text-300 text-center mb-4">
          {isCowork ? t.coworkUnavailableBody : t.pairingBody}
        </p>

        {!isCowork ? (
          <div className="mb-6 rounded-[14px] border border-border-300 bg-bg-000 px-3 py-3 text-left space-y-2">
            <p className="font-small text-text-100">
              {mcp?.nativeHostInstalled
                ? t.mcpHostInstalled
                : t.mcpHostMissing}
            </p>
            {mcp?.nativeHostInstalled && mcp.hostLabel ? (
              <p className="font-small text-text-400">
                {t.mcpHostLabel(mcp.hostLabel)}
                {mcp.hostName ? (
                  <span className="font-mono text-[0.6875rem]"> · {mcp.hostName}</span>
                ) : null}
              </p>
            ) : null}
            {mcp?.nativeHostInstalled ? (
              <p className="font-small text-text-300">
                {mcp.mcpConnected ? t.mcpSessionConnected : t.mcpSessionIdle}
              </p>
            ) : null}
            <div className="flex flex-wrap gap-2 pt-1">
              <button
                type="button"
                disabled={mcpBusy}
                onClick={() => void refreshMcp()}
                className="px-3 py-1.5 border border-border-300 text-text-200 rounded-[14px] hover:bg-bg-200 transition-colors font-ui text-[13px] disabled:opacity-50"
              >
                {t.mcpRefresh}
              </button>
              <button
                type="button"
                disabled={mcpBusy}
                onClick={() => void reconnectMcp()}
                className="px-3 py-1.5 border border-border-300 text-text-200 rounded-[14px] hover:bg-bg-200 transition-colors font-ui text-[13px] disabled:opacity-50"
              >
                {t.mcpReconnect}
              </button>
              <button
                type="button"
                onClick={() => void chrome.runtime.openOptionsPage()}
                className="px-3 py-1.5 border border-border-300 text-text-200 rounded-[14px] hover:bg-bg-200 transition-colors font-ui text-[13px]"
              >
                {t.settings}
              </button>
            </div>
          </div>
        ) : null}

        <div className="flex justify-end gap-3">
          {isCowork ? (
            <button
              type="button"
              onClick={() => void chrome.tabs.create({ url: 'https://claude.ai' })}
              className="px-[14px] py-2 border border-border-300 text-text-200 rounded-[14px] hover:bg-bg-200 transition-colors font-ui font-medium text-[14px]"
            >
              {t.coworkOpenClaudeAi}
            </button>
          ) : null}
          <button
            type="button"
            onClick={onClose}
            className="px-[14px] py-2 bg-text-100 text-bg-100 rounded-[14px] hover:bg-text-200 transition-colors font-ui font-medium text-[14px]"
          >
            {isCowork ? t.switchBackClassic : t.pairingGotIt}
          </button>
        </div>
      </div>
    </div>
  );
}
