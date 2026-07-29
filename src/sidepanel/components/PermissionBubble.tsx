/**
 * 授权气泡 —— 整个扩展里**唯一**的 grant 入口。
 *
 * 两种官方布局（`assets/sidepanel-CEYFzMrx.js`）：
 *
 * 1. **CZ** — 站点动作授权（read/click/type/navigate/…）
 *    根 bg-bg-000 rounded-[14px]；ks 举手盾 + "New permissions required"；
 *    wants-to + host；CLICK 用 ZC 缩放预览；Allow / Decline / Always allow…
 *
 * 2. **eS** — `update_plan` / PLAN_APPROVAL（截图里的「Claude's plan」）
 *    根同 rounded-[14px]；ListChecks + "Claude’s plan"；
 *    domains（Globe）+ 编号 approach；**实心** Approve plan + Make changes；
 *    无 Always 行；页脚 "will only use the sites listed…"
 *
 * 外层 sticky 外壳（border + shadow + h-3 spacer）由 App 挂载。
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { cn } from './cn';
import { availableScopes } from '@/permissions/manager';
import { PERMISSION, type PermissionScope } from '@/shared/types';
import {
  EscKeyIcon,
  Globe,
  ListChecks,
  MetaOrCtrlHint,
  ReturnKeyIcon,
  ShieldIcon,
} from './icons';
import type { PermissionItem } from '../state/transcript';
import { useUi } from '@/i18n/UiLocaleContext';

/** 键盘去抖：先亮 isActive，再真正提交。原版 150ms。 */
const KEY_ARM_DELAY = 150;
const COMMIT_DELAY = 150;

export interface PermissionBubbleProps {
  item: PermissionItem;
  onAnswer: (toolUseId: string, granted: boolean, scope: PermissionScope) => void;
  /**
   * answered 时 compact 摘要（sticky 层只展示未决请求）。
   * 流内历史行仍可渲染 answered 态。
   */
  compactAnswered?: boolean;
  /**
   * Official EZ / CZ `disableAlwaysAllow` — hide Always row + Cmd/Ctrl+Enter always.
   * Used by mcpPermissionOnly popup (MCP wire is boolean-only / ONCE).
   */
  disableAlwaysAllow?: boolean;
}

type ActiveChoice = 'once' | 'deny' | 'always' | 'approve' | 'reject' | null;

type PlanStructure = {
  domains: Array<string | { domain: string; category?: string }>;
  approach: string[];
};

function readPlanStructure(actionData: unknown): PlanStructure {
  const raw = (actionData as { plan?: unknown } | null)?.plan ?? actionData;
  if (!raw || typeof raw !== 'object') return { domains: [], approach: [] };
  const o = raw as { domains?: unknown; approach?: unknown };
  const domains = Array.isArray(o.domains) ? o.domains : [];
  const approach = Array.isArray(o.approach)
    ? o.approach.filter((s): s is string => typeof s === 'string')
    : [];
  return { domains, approach };
}

function domainName(
  entry: string | { domain: string; category?: string },
): { name: string; isForceAsk: boolean } {
  if (typeof entry === 'string') return { name: entry, isForceAsk: false };
  return {
    name: entry.domain,
    isForceAsk: entry.category === 'category3',
  };
}

export function PermissionBubble({
  item,
  onAnswer,
  compactAnswered = true,
  disableAlwaysAllow = false,
}: PermissionBubbleProps) {
  const t = useUi();
  const { request, answer } = item;
  const answered = answer !== undefined;

  const scopes = useMemo(() => availableScopes(request.permission), [request.permission]);
  // Official disableAlwaysAllow (MCP popup / enterprise) hides Always entirely.
  const canAlways = !disableAlwaysAllow && scopes.includes('always');
  const isPlan = request.permission === PERMISSION.PLAN_APPROVAL;
  const plan = useMemo(
    () => (isPlan ? readPlanStructure(request.actionData) : null),
    [isPlan, request.actionData],
  );

  const [armed, setArmed] = useState(false);
  const [active, setActive] = useState<ActiveChoice>(null);
  const committed = useRef(false);

  useEffect(() => {
    if (answered) return;
    const id = window.setTimeout(() => setArmed(true), KEY_ARM_DELAY);
    return () => window.clearTimeout(id);
  }, [answered]);

  const commit = (granted: boolean, scope: PermissionScope, choice: ActiveChoice) => {
    if (committed.current || answered) return;
    committed.current = true;
    setActive(choice);
    window.setTimeout(() => {
      onAnswer(request.toolUseId, granted, scope);
    }, COMMIT_DELAY);
  };

  // CZ: Enter=once, Cmd/Ctrl+Enter=always, Esc=deny
  // eS: Enter=approve, Cmd/Ctrl+Enter or Esc=reject (official capture phase)
  useEffect(() => {
    if (answered || !armed) return;

    const onKey = (e: KeyboardEvent) => {
      if (isPlan) {
        if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          commit(false, 'once', 'reject');
          return;
        }
        if (e.key === 'Enter') {
          if (e.isComposing || e.keyCode === 229) return;
          e.preventDefault();
          e.stopPropagation();
          if (e.metaKey || e.ctrlKey) {
            commit(false, 'once', 'reject');
          } else {
            commit(true, 'once', 'approve');
          }
        }
        return;
      }

      if (e.key === 'Escape') {
        e.preventDefault();
        commit(false, 'once', 'deny');
        return;
      }
      if (e.key === 'Enter') {
        if (e.isComposing || e.keyCode === 229) return;
        e.preventDefault();
        if ((e.metaKey || e.ctrlKey) && canAlways) {
          commit(true, 'always', 'always');
        } else {
          commit(true, 'once', 'once');
        }
      }
    };

    // Official eS uses capture=true so composer doesn't eat Enter.
    window.addEventListener('keydown', onKey, isPlan);
    return () => window.removeEventListener('keydown', onKey, isPlan);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [answered, armed, canAlways, isPlan, request.toolUseId]);

  // Official: answered permissionPrompt is cleared — no full card in the stream.
  if (answered && compactAnswered && answer) {
    return (
      <div className="flex items-center gap-2 py-1 text-text-500">
        {isPlan ? (
          <ListChecks size={16} className="text-text-500 shrink-0" />
        ) : (
          <ShieldIcon size={16} className="text-text-500 shrink-0" />
        )}
        <AnsweredNote granted={answer.granted} scope={answer.scope} isPlan={isPlan} />
      </div>
    );
  }

  if (answered && answer) {
    return (
      <div className="bg-bg-000 rounded-[14px]">
        <div className="flex items-center gap-2 py-[10px] px-4">
          {isPlan ? (
            <ListChecks size={20} className="text-text-100" />
          ) : (
            <ShieldIcon size={20} className="text-text-100" />
          )}
          <h3 className="font-base text-text-100">
            {isPlan ? t.claudePlanTitle : t.permission}
          </h3>
        </div>
        <div className="border-t border-border-300 mb-4" />
        <div className="px-4 pb-3">
          <AnsweredNote granted={answer.granted} scope={answer.scope} isPlan={isPlan} />
        </div>
      </div>
    );
  }

  // ── Official jZ domain-transition card ──────────────────────────────
  const isDomainTransition = request.permission === PERMISSION.DOMAIN_TRANSITION;
  if (isDomainTransition) {
    const data = (request.actionData ?? null) as
      | { fromDomain?: string; toDomain?: string }
      | null;
    const fromDomain =
      (typeof data?.fromDomain === 'string' && data.fromDomain) || request.host || '?';
    const toDomain =
      (typeof data?.toDomain === 'string' && data.toDomain) ||
      (() => {
        try {
          return request.url ? new URL(request.url).hostname : '?';
        } catch {
          return '?';
        }
      })();

    return (
      <div className="bg-bg-000 rounded-[14px]">
        <div className="flex items-center gap-2 py-[10px] px-4">
          <ShieldIcon size={20} className="text-text-100" />
          <h3 className="font-base text-text-100">{t.newPermissionsRequired}</h3>
        </div>
        <div className="border-t border-border-300 mb-4" />
        <div className="space-y-4 px-4">
          <div>
            <p className="font-base-bold text-text-100">
              {t.domainTransitionPaused(fromDomain, toDomain)}
            </p>
          </div>
        </div>
        <div className="px-3 py-[10px] space-y-[5px] mt-[10px] mb-0.5">
          <ScopeButton
            isActive={active === 'once'}
            onClick={() => commit(true, 'once', 'once')}
          >
            <span>{t.domainTransitionContinue}</span>
            <ReturnKeyIcon className="text-text-500" />
          </ScopeButton>
          <ScopeButton isActive={active === 'deny'} onClick={() => commit(false, 'once', 'deny')}>
            <span>{t.domainTransitionStop}</span>
            <EscKeyIcon className="text-text-500" />
          </ScopeButton>
          <div className="border-t-[0.5px] border-border-300 my-3 -mx-3" />
          {canAlways ? (
            <ScopeButton
              isActive={active === 'always'}
              height="55px"
              onClick={() => commit(true, 'always', 'always')}
            >
              <div className="flex flex-col items-start">
                <span>{t.domainTransitionAlways}</span>
                <span className="font-small text-text-500">{t.domainTransitionAlwaysHint}</span>
              </div>
              <span className="flex items-center gap-0.5">
                <MetaOrCtrlHint className="text-text-500" />
                <ReturnKeyIcon className="text-text-500" />
              </span>
            </ScopeButton>
          ) : null}
        </div>
      </div>
    );
  }

  // ── Official eS plan card (NOT CZ) ──────────────────────────────────
  if (isPlan && plan) {
    const domains = plan.domains;
    const approach = plan.approach;
    return (
      <div className="bg-bg-000 rounded-[14px]">
        <div className="flex items-center justify-between py-[10px] px-4">
          <div className="flex items-center gap-2">
            <ListChecks size={20} className="text-text-100" />
            <h3 className="font-base text-text-100">{t.claudePlanTitle}</h3>
          </div>
        </div>

        <div className="border-t border-border-300" />

        <div className="px-4 py-3 space-y-4 max-h-[40vh] overflow-y-auto">
          {domains.length > 0 ? (
            <div>
              <p className="font-small text-text-400 mb-2">{t.planAllowSites}</p>
              <div className="space-y-2">
                {domains.map((entry, idx) => {
                  const { name } = domainName(entry);
                  return (
                    <div key={`${name}-${idx}`} className="flex items-start gap-2">
                      <span className="flex-shrink-0 w-5 h-5 flex items-center justify-center">
                        <Globe size={16} className="text-text-400" />
                      </span>
                      <span className="font-base text-text-100" dir="ltr">
                        {name}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : null}

          {approach.length > 0 ? (
            <div>
              <p className="font-small text-text-400 mb-2">{t.planApproach}</p>
              <div className="space-y-2">
                {approach.map((step, idx) => (
                  <div key={idx} className="flex items-start gap-2">
                    <span className="flex-shrink-0 w-5 h-5 rounded-full border-border-300 border-0.5 flex items-center justify-center text-xs text-text-400">
                      {idx + 1}
                    </span>
                    <span className="font-base text-text-100" dir="ltr">
                      {step}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>

        <div className="px-3 py-[10px] space-y-[5px] mt-[10px]">
          <ScopeButton
            isPrimary
            isActive={active === 'approve'}
            onClick={() => commit(true, 'once', 'approve')}
          >
            <span>{t.approvePlan}</span>
            <ReturnKeyIcon className="text-text-500" />
          </ScopeButton>
          <ScopeButton
            isActive={active === 'reject'}
            onClick={() => commit(false, 'once', 'reject')}
          >
            <span>{t.makeChanges}</span>
            <span className="flex items-center gap-0.5">
              <MetaOrCtrlHint className="text-text-500" />
              <ReturnKeyIcon className="text-text-500" />
            </span>
          </ScopeButton>
          <p className="font-small text-text-500 pt-1 px-1">{t.planFooter}</p>
        </div>
      </div>
    );
  }

  // ── Official CZ site-permission card ────────────────────────────────
  const isType = request.permission === PERMISSION.TYPE;
  const isClick = request.permission === PERMISSION.CLICK;
  const typeText = isType ? readTypeText(request) : null;
  const clickCoord = isClick ? readCoordinate(request.actionData) : null;
  const clickViewport = isClick ? readViewport(request.actionData) : null;
  // Official MZ: screenshot lives on actionData.screenshot (not top-level).
  // We still accept request.screenshot for older emitters.
  const shotUrl = readScreenshot(request);

  // Official CZ: display host from new URL(url).host (includes port when present).
  let displayHost = request.host || '';
  if (request.url) {
    try {
      displayHost = new URL(request.url).host;
    } catch {
      /* keep request.host */
    }
  }

  // Official CZ / MZ card body. EZ (mcpPermissionOnly) wraps with its own
  // max-w-sm border rounded-[14px]; chat sticky also supplies a shell.
  // Keep bg-bg-000 rounded so chat stream cards still look complete.
  return (
    <div className="bg-bg-000 rounded-[14px]">
      <div className="flex items-center gap-2 py-[10px] px-4">
        {/* Official CZ header icon is ks (raised hand path), exported as ShieldIcon */}
        <ShieldIcon size={20} className="text-text-100" />
        <h3 className="font-base text-text-100">{t.newPermissionsRequired}</h3>
      </div>

      <div className="border-t border-border-300 mb-4" />

      <div className="space-y-4 px-4">
        <div>
          <p className="font-base-bold text-text-100">
            {t.claudeWantsTo(verbFor(request.permission, t))}
          </p>
          {displayHost ? (
            <p className="font-claude-response-code text-text-200" dir="ltr">
              {displayHost}
            </p>
          ) : null}
        </div>

        {/* Official CZ: e===CLICK && screenshot && coordinate → ZC({ className: "mx-auto" }) */}
        {isClick && shotUrl && clickCoord ? (
          <div>
            <ClickZoomPreview
              screenshot={shotUrl}
              coordinates={clickCoord}
              viewportDimensions={clickViewport}
              className="mx-auto"
            />
          </div>
        ) : null}

        {isType && typeText ? (
          <div>
            <p className="font-base-bold text-text-100 mb-2">{t.textToBeTyped}</p>
            <div className="p-3 bg-bg-100 border border-border-200 rounded-lg max-h-[300px] overflow-y-auto">
              <code
                dir="ltr"
                style={{ unicodeBidi: 'isolate' }}
                className="font-claude-response-code text-text-200 whitespace-pre-wrap break-words overflow-wrap-anywhere"
              >
                {typeText}
              </code>
            </div>
          </div>
        ) : null}
      </div>

      <Choices
        canAlways={canAlways}
        disableAlwaysAllow={disableAlwaysAllow}
        active={active}
        onPick={commit}
      />
    </div>
  );
}

/**
 * Official ZC (sidepanel-CEYFzMrx.js) — 1:1 port:
 *   - outer: relative overflow-hidden + className
 *   - scale 1 → zoomLevel (default 2.5) after 300ms, transform 0.6s ease-out
 *   - transformOrigin clamped so zoom stays inside the box
 *   - no click marker, no border, no forced aspect-ratio
 */
function ClickZoomPreview({
  screenshot,
  coordinates,
  viewportDimensions,
  className = '',
  zoomLevel = 2.5,
}: {
  screenshot: string;
  coordinates: [number, number];
  viewportDimensions?: { width: number; height: number } | null;
  className?: string;
  zoomLevel?: number;
}) {
  const imgRef = useRef<HTMLImageElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const [origin, setOrigin] = useState({ x: 50, y: 50 });

  useEffect(() => {
    const recompute = () => {
      const img = imgRef.current;
      const box = boxRef.current;
      if (!img || !box) return;

      const cssW = viewportDimensions?.width || img.naturalWidth;
      const cssH = viewportDimensions?.height || img.naturalHeight;
      if (!cssW || !cssH || !img.naturalWidth || !img.naturalHeight) return;

      const sx = img.naturalWidth / cssW;
      const sy = img.naturalHeight / cssH;
      const cx = coordinates[0] * sx;
      const cy = coordinates[1] * sy;

      const bw = box.offsetWidth;
      const bh = box.offsetHeight;
      if (bw <= 0 || bh <= 0) return;

      const fit = Math.min(bw / img.naturalWidth, bh / img.naturalHeight);
      const drawnW = img.naturalWidth * fit;
      const drawnH = img.naturalHeight * fit;
      const ox = (bw - drawnW) / 2;
      const oy = (bh - drawnH) / 2;
      const px = cx * fit + ox;
      const py = cy * fit + oy;

      // Official clamp so scaled content still covers the viewport box.
      const a = zoomLevel;
      if (a <= 1) {
        setOrigin({ x: (px / bw) * 100, y: (py / bh) * 100 });
        return;
      }
      const minXEdge = (ox * a) / (a - 1);
      const maxXEdge = ((ox + drawnW) * a - bw) / (a - 1);
      const minYEdge = (oy * a) / (a - 1);
      const maxYEdge = ((oy + drawnH) * a - bh) / (a - 1);
      const minXPt = (px * a - bw) / (a - 1);
      const maxXPt = (px * a) / (a - 1);
      const minYPt = (py * a - bh) / (a - 1);
      const maxYPt = (py * a) / (a - 1);
      const loX = Math.max(minXEdge, minXPt);
      const hiX = Math.min(maxXEdge, maxXPt);
      const loY = Math.max(minYEdge, minYPt);
      const hiY = Math.min(maxYEdge, maxYPt);

      let rx = px;
      let ry = py;
      if (loX <= hiX) rx = Math.max(loX, Math.min(hiX, px));
      if (loY <= hiY) ry = Math.max(loY, Math.min(hiY, py));

      setOrigin({ x: (rx / bw) * 100, y: (ry / bh) * 100 });
    };

    const img = imgRef.current;
    if (img && !img.complete) {
      img.addEventListener('load', recompute);
      window.addEventListener('resize', recompute);
      return () => {
        img.removeEventListener('load', recompute);
        window.removeEventListener('resize', recompute);
      };
    }
    recompute();
    window.addEventListener('resize', recompute);
    return () => window.removeEventListener('resize', recompute);
  }, [
    screenshot,
    coordinates,
    viewportDimensions,
    zoomLevel,
    coordinates[0],
    coordinates[1],
  ]);

  useEffect(() => {
    setScale(1);
    const t = window.setTimeout(() => setScale(zoomLevel), 300);
    return () => window.clearTimeout(t);
  }, [screenshot, zoomLevel]);

  return (
    // Official: `relative overflow-hidden ${className}` with className "mx-auto".
    // Use block img (w-full h-auto) so the card gets intrinsic height — official
    // h-full only works when a parent already has a definite height.
    <div ref={boxRef} className={`relative overflow-hidden ${className}`}>
      <div
        className="w-full"
        style={{
          transform: `scale(${scale})`,
          transformOrigin: `${origin.x}% ${origin.y}%`,
          transition: 'transform 0.6s ease-out',
        }}
      >
        <img
          ref={imgRef}
          src={screenshot}
          alt="Screenshot with click location"
          className="w-full h-auto block"
          style={{ objectFit: 'contain' }}
        />
      </div>
    </div>
  );
}

function readScreenshot(request: PermissionItem['request']): string | null {
  if (typeof request.screenshot === 'string' && request.screenshot.length > 0) {
    return request.screenshot;
  }
  const data = request.actionData as { screenshot?: unknown } | null;
  if (data && typeof data.screenshot === 'string' && data.screenshot.length > 0) {
    return data.screenshot;
  }
  return null;
}

function readCoordinate(actionData: unknown): [number, number] | null {
  if (!actionData || typeof actionData !== 'object') return null;
  const o = actionData as {
    coordinate?: unknown;
    coordinates?: unknown;
  };
  const raw = o.coordinate ?? o.coordinates;
  if (!Array.isArray(raw) || raw.length < 2) return null;
  const x = Number(raw[0]);
  const y = Number(raw[1]);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return [x, y];
}

function readViewport(
  actionData: unknown,
): { width: number; height: number } | null {
  if (!actionData || typeof actionData !== 'object') return null;
  const o = actionData as {
    viewport?: { width?: unknown; height?: unknown };
    viewportDimensions?: { width?: unknown; height?: unknown };
    imageWidth?: unknown;
    imageHeight?: unknown;
  };
  const v = o.viewport ?? o.viewportDimensions;
  if (v) {
    const w = Number(v.width);
    const h = Number(v.height);
    if (Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) {
      return { width: w, height: h };
    }
  }
  const w = Number(o.imageWidth);
  const h = Number(o.imageHeight);
  if (Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) {
    return { width: w, height: h };
  }
  return null;
}

function readTypeText(request: PermissionItem['request']): string | null {
  const data = request.actionData as { text?: unknown } | null;
  if (data && typeof data.text === 'string' && data.text.length > 0) {
    return data.text;
  }
  if (
    request.actionLabel &&
    request.actionLabel !== request.host &&
    !/^type$/i.test(request.actionLabel)
  ) {
    // describeAction often returns "Type "hello"" — strip prefix quotes if present
    const m = /^Type\s+["“]([\s\S]*)["”]$/i.exec(request.actionLabel.trim());
    if (m) return m[1] ?? request.actionLabel;
    return request.actionLabel;
  }
  return null;
}

/**
 * Official sticky shell around active permission prompt:
 *   absolute bottom-0 left-0 right-0 z-[10]
 *   mx-auto max-w-3xl md:px-2
 *   mx-3 md:mx-0 border border-border-300 rounded-[14px]
 *     shadow-[0_4px_20px_0_rgba(0,0,0,0.04)] bg-bg-100
 *   + bg-bg-100 h-3 spacer
 */
export function PermissionStickyShell({
  children,
  promptRef,
  /** Official: pr-2 when messages scroller overflows (stable gutter alignment). */
  scrollerOverflow = false,
}: {
  children: React.ReactNode;
  promptRef?: React.Ref<HTMLDivElement>;
  scrollerOverflow?: boolean;
}) {
  return (
    <div
      ref={promptRef}
      className={cn(
        // Official: absolute bottom-0 left-0 right-0 z-[10] (+ pr-2 when overflow)
        'absolute bottom-0 left-0 right-0 z-[10]',
        scrollerOverflow && 'pr-2',
      )}
    >
      <div className="mx-auto max-w-3xl md:px-2">
        {/*
          Official shell class string exact (no overflow-hidden):
            mx-3 md:mx-0 border border-border-300 rounded-[14px]
            shadow-[0_4px_20px_0_rgba(0,0,0,0.04)] bg-bg-100
        */}
        <div className="mx-3 md:mx-0 border border-border-300 rounded-[14px] shadow-[0_4px_20px_0_rgba(0,0,0,0.04)] bg-bg-100">
          {children}
        </div>
        <div className="bg-bg-100 h-3" />
      </div>
    </div>
  );
}

/** Official CZ action choices (site permissions only — plan uses eS branch). */
function Choices({
  canAlways,
  disableAlwaysAllow,
  active,
  onPick,
}: {
  canAlways: boolean;
  disableAlwaysAllow: boolean;
  active: ActiveChoice;
  onPick: (granted: boolean, scope: PermissionScope, choice: ActiveChoice) => void;
}) {
  const t = useUi();
  return (
    // Official CZ: px-3 py-[10px] space-y-[5px] mt-[10px] mb-0.5
    <div className="px-3 py-[10px] space-y-[5px] mt-[10px] mb-0.5">
      <ScopeButton
        isActive={active === 'once'}
        onClick={() => onPick(true, 'once', 'once')}
      >
        <span>{t.allowThisAction}</span>
        <ReturnKeyIcon className="text-text-500" />
      </ScopeButton>

      <ScopeButton isActive={active === 'deny'} onClick={() => onPick(false, 'once', 'deny')}>
        <span>{t.decline}</span>
        <EscKeyIcon className="text-text-500" />
      </ScopeButton>

      {/*
        Official CZ (disableAlwaysAllow=l):
          always render divider after Decline;
          l ? "Site-level permissions are disabled for this site."
            : Always-allow row (or disabled copy when always not in scopes).
        MCP EZ passes disableAlwaysAllow — Always click/hotkey still no-ops.
      */}
      <div className="border-t-[0.5px] border-border-300 my-3 -mx-3" />

      {disableAlwaysAllow ? (
        <p className="font-small text-text-500 px-1 mt-2">{t.sitePermissionsDisabled}</p>
      ) : canAlways ? (
        <ScopeButton
          isActive={active === 'always'}
          height="55px"
          onClick={() => onPick(true, 'always', 'always')}
        >
          <div className="flex flex-col items-start">
            <span>{t.alwaysAllowSite}</span>
            <span className="font-small text-text-500">{t.browseClickType}</span>
          </div>
          <span className="flex items-center gap-0.5">
            <MetaOrCtrlHint className="text-text-500" />
            <ReturnKeyIcon className="text-text-500" />
          </span>
        </ScopeButton>
      ) : (
        <p className="font-small text-text-500 px-1 mt-2">{t.sitePermissionsDisabled}</p>
      )}

      <p className="font-small text-text-500 px-1 mt-2">
        {t.permissionFooter}
        <button
          type="button"
          onClick={() => void chrome.runtime.openOptionsPage()}
          className="inline-link hover:text-text-400"
        >
          {t.settingsLink}
        </button>
        {t.permissionFooterAfter || null}
      </p>
    </div>
  );
}

/**
 * Official QC (sidepanel-CEYFzMrx.js) — class string is template-literal exact:
 *
 *   w-full font-base flex min-w-[75px] px-[14px] py-[3px] justify-between
 *   items-center gap-2 rounded-lg border-[0.5px] transition-colors font-medium
 *   + isActive  → text-text-100 bg-bg-300 border-border-400
 *   + isPrimary → bg-text-000 text-bg-000 border-text-000 hover:bg-text-100
 *   + else      → text-text-100 border-border-200 hover:bg-bg-100
 *   + height ? "" : "h-9"
 *   style: height ? { height } : undefined
 *
 * Do not invent extra utilities (no shadow, no bg default, no type-specific sizes).
 */
function ScopeButton({
  children,
  isActive = false,
  isPrimary = false,
  height,
  onClick,
}: {
  children: React.ReactNode;
  isActive?: boolean;
  isPrimary?: boolean;
  height?: string | number;
  onClick: () => void;
}) {
  // Keep the same concatenation order as official QC so font-medium wins the
  // same way against font-base in the authored class list.
  const className = `w-full font-base flex min-w-[75px] px-[14px] py-[3px] justify-between items-center gap-2 rounded-lg border-[0.5px] transition-colors font-medium ${
    isActive
      ? 'text-text-100 bg-bg-300 border-border-400'
      : isPrimary
        ? 'bg-text-000 text-bg-000 border-text-000 hover:bg-text-100'
        : 'text-text-100 border-border-200 hover:bg-bg-100'
  } ${height ? '' : 'h-9'}`;

  return (
    <button
      type="button"
      onClick={onClick}
      className={className}
      style={height ? { height } : undefined}
    >
      {children}
    </button>
  );
}

function AnsweredNote({
  granted,
  scope,
  isPlan,
}: {
  granted: boolean;
  scope: PermissionScope;
  isPlan?: boolean;
}) {
  const t = useUi();
  return (
    <p
      className={cn(
        'font-small min-w-0 truncate',
        granted ? 'text-text-500' : 'text-danger-100',
      )}
    >
      {granted
        ? isPlan
          ? t.planApproved
          : scope === 'always'
            ? t.allowedRemembered
            : t.allowedOnce
        : isPlan
          ? t.planRejected
          : t.declined}
    </p>
  );
}

function verbFor(permission: string, t: ReturnType<typeof useUi>): string {
  switch (permission) {
    case PERMISSION.READ_PAGE_CONTENT:
      return t.verbRead;
    case PERMISSION.CLICK:
      return t.verbClick;
    case PERMISSION.TYPE:
      return t.verbType;
    case PERMISSION.NAVIGATE:
      return t.verbNavigate;
    case PERMISSION.EXECUTE_JAVASCRIPT:
      return t.verbJs;
    case PERMISSION.UPLOAD_IMAGE:
      return t.verbUpload;
    case PERMISSION.READ_CONSOLE_MESSAGES:
      return t.verbConsole;
    case PERMISSION.READ_NETWORK_REQUESTS:
      return t.verbNetwork;
    case PERMISSION.PLAN_APPROVAL:
      return t.verbPlan;
    case PERMISSION.DOMAIN_TRANSITION:
      return t.verbNavigate;
    default:
      return t.verbAct;
  }
}
