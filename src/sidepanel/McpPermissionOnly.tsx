/**
 * Official mcpPermissionOnly popup (Claude in Chrome 1.0.81 `EZ` / jZ).
 *
 * sidepanel.html?mcpPermissionOnly=true&requestId=<uuid>
 *
 * Layout (sidepanel-CEYFzMrx.js EZ, class strings exact):
 *   Gate:  flex center h-screen bg-bg-100 p-3 > max-w-md > BeforeYouStart
 *   Card:  flex center h-screen bg-bg-100 p-3 > max-w-sm border rounded-[14px] > MZ
 *   Wait:  flex center h-screen bg-bg-100 > text-text-200 text-sm
 *
 * Wire: MCP_PERMISSION_RESPONSE { requestId, allowed, scope? }.
 * Ordinary tools: Always row disabled (disableAlwaysAllow) — SW grants ONCE + retries.
 * DOMAIN_TRANSITION (jZ): Always continue stays available → permanent pair grant.
 */

import { useCallback, useEffect, useState } from 'react';
import { PERMISSION, type PermissionRequest, type PermissionScope } from '@/shared/types';
import { PermissionBubble } from './components/PermissionBubble';
import { BeforeYouStart } from './components/BeforeYouStart';
import type { PermissionItem } from './state/transcript';
import { nextId } from './state/transcript';
import { bootstrapTheme, applyMode } from './theme';
import { loadSettings } from '@/storage/settings';
import { UiLocaleProvider, useUi } from '@/i18n/UiLocaleContext';
import { DEFAULT_SETTINGS, type Settings } from '@/shared/types';
import { loadOnboarding, patchOnboarding } from '@/onboarding/store';

bootstrapTheme();

function buildItem(request: PermissionRequest): PermissionItem {
  return {
    kind: 'permission',
    id: nextId('mcp_perm'),
    toolUseId: request.toolUseId,
    request,
    at: Date.now(),
  };
}

function WaitingCopy() {
  const t = useUi();
  return (
    <div className="text-text-200 text-sm">{t.waitingForPermission}</div>
  );
}

export function McpPermissionOnlyRoot() {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [item, setItem] = useState<PermissionItem | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Official EZ: BROWSER_CONTROL_PERMISSION_ACCEPTED → our beforeYouStartDone. */
  const [gateAccepted, setGateAccepted] = useState<boolean | null>(null);

  const params = new URLSearchParams(window.location.search);
  const requestId = params.get('requestId') ?? '';

  useEffect(() => {
    void loadSettings().then((s) => {
      setSettings(s);
      applyMode(s.mode);
    });
  }, []);

  useEffect(() => {
    void loadOnboarding().then((flags) => {
      setGateAccepted(Boolean(flags.beforeYouStartDone));
    });
  }, []);

  useEffect(() => {
    if (!requestId) {
      setError('Missing requestId');
      return;
    }
    const key = `mcp_prompt_${requestId}`;
    void chrome.storage.local.get(key).then((raw) => {
      const data = raw[key] as
        | { prompt?: PermissionRequest; tabId?: number; timestamp?: number }
        | undefined;
      if (!data?.prompt) {
        setError('Permission request expired or missing.');
        return;
      }
      const prompt = { ...data.prompt };
      if (!prompt.toolUseId) prompt.toolUseId = requestId;
      setItem(buildItem(prompt));
    });
  }, [requestId]);

  const acceptGate = useCallback(() => {
    void patchOnboarding({ beforeYouStartDone: true }).then(() => {
      setGateAccepted(true);
    });
  }, []);

  /** Official wire: { type, requestId, allowed }; scope for DOMAIN_TRANSITION Always. */
  const respond = useCallback(
    (allowed: boolean, scope: PermissionScope = 'once') => {
      if (!requestId) return;
      void chrome.runtime
        .sendMessage({
          type: 'MCP_PERMISSION_RESPONSE',
          requestId,
          allowed,
          scope,
        })
        .catch(() => {})
        .finally(() => {
          setTimeout(() => {
            try {
              window.close();
            } catch {
              /* ignore */
            }
          }, 50);
        });
    },
    [requestId],
  );

  const onAnswer = useCallback(
    (_toolUseId: string, granted: boolean, scope: PermissionScope) => {
      setItem((prev) =>
        prev ? { ...prev, answer: { granted, scope } } : prev,
      );
      respond(granted, scope);
    },
    [respond],
  );

  const isDomainTransition =
    item?.request.permission === PERMISSION.DOMAIN_TRANSITION;

  // ── loading onboarding flag ──
  if (gateAccepted === null) {
    return (
      <UiLocaleProvider locale={settings.locale}>
        <div className="flex items-center justify-center h-screen bg-bg-100 p-3">
          <div className="text-text-200 text-sm">Loading…</div>
        </div>
      </UiLocaleProvider>
    );
  }

  // ── Official EZ gate: max-w-md + Before you start (xZ / BROWSER_CONTROL) ──
  if (!gateAccepted) {
    return (
      <UiLocaleProvider locale={settings.locale}>
        <div className="flex items-center justify-center h-screen bg-bg-100 p-3">
          <div className="w-full max-w-md">
            <BeforeYouStart onContinue={acceptGate} embedded />
          </div>
        </div>
      </UiLocaleProvider>
    );
  }

  // ── error / missing prompt ──
  if (error) {
    return (
      <UiLocaleProvider locale={settings.locale}>
        <div className="flex items-center justify-center h-screen bg-bg-100 p-3">
          <p className="font-small text-text-300 p-4">{error}</p>
        </div>
      </UiLocaleProvider>
    );
  }

  // ── Official EZ wait ──
  if (!item) {
    return (
      <UiLocaleProvider locale={settings.locale}>
        <div className="flex items-center justify-center h-screen bg-bg-100">
          <WaitingCopy />
        </div>
      </UiLocaleProvider>
    );
  }

  // ── Official EZ card: max-w-sm border + MZ
  // Ordinary tools: disableAlwaysAllow. jZ domain transition keeps Always continue.
  return (
    <UiLocaleProvider locale={settings.locale}>
      <div className="flex items-center justify-center h-screen bg-bg-100 p-3">
        <div className="w-full max-w-sm border border-border-300 rounded-[14px]">
          <PermissionBubble
            item={item}
            onAnswer={onAnswer}
            compactAnswered={false}
            disableAlwaysAllow={!isDomainTransition}
          />
        </div>
      </div>
    </UiLocaleProvider>
  );
}
