/**
 * 权限管理器。所有会触碰页面的工具都必须先过这里。
 *
 * 设计上的几条硬规则（照搬原版模型，理由写在各自位置）：
 *
 *  1. **授权只能来自聊天界面。** 页面内容不是授权来源。这条不是靠代码强制的，
 *     而是靠架构：本模块从不读取页面 DOM，唯一的 grant 入口是 `resolve()`，
 *     而 `resolve()` 只被侧栏的授权气泡调用。
 *
 *  2. **拒绝是粘性的，同意不是。** 用户点"拒绝"后，同一 turn 内不再重复问同一个
 *     (host, permission)，否则模型可以靠反复重试把用户问烦了点同意。
 *     反过来"同意"不会自动升级到更大范围 —— 想要 domain 级得用户自己选。
 *
 *  3. **不可逆动作绕过缓存。** 已经授权过 click 不等于授权点"确认付款"。
 *     命中 looksIrreversible / isSensitiveHost 时强制重新问。
 *
 *  4. **turn 结束清空 turn 级授权。** 新一轮对话是新的意图，旧授权不继承。
 */

import {
  PERMISSION,
  type Permission,
  type PermissionDecision,
  type PermissionScope,
} from '@/shared/types';
import { STORAGE_KEYS, SESSION_KEYS, get, set } from '@/storage/keys';
import { peekSettings } from '@/storage/settings';
import {
  NO_PERSISTENT_GRANT,
  isSensitiveHost,
  looksIrreversible,
} from './rules';

/** host → 已永久授权的权限集合 */
type GrantMap = Record<string, Permission[]>;

/** Official domain_transition always grant: fromDomain → toDomain */
export type DomainTransitionGrant = {
  fromDomain: string;
  toDomain: string;
};

export interface CheckOptions {
  /** 动作文案，用来判断是不是不可逆操作 */
  actionLabel?: string;
  /**
   * 强制重新询问，忽略所有缓存。
   * 用于模型明显要做高风险动作、或者用户开了 forcePrompt。
   */
  force?: boolean;
  /**
   * Official ONCE grant key (tool_use id). MCP empty PM matches grants by this id.
   */
  toolUseId?: string;
  /** Official domain_transition: source host (current page). */
  fromDomain?: string;
  /** Official domain_transition: destination host. */
  toDomain?: string;
}

export type PermissionManagerOptions = {
  /**
   * Official open-MCP: `new WN(() => !1, {})` — no chat always/turn/skip auto-allow.
   * Only operable/deny/allow-list gates + per-toolUseId ONCE grants.
   */
  isolated?: boolean;
};

/**
 * 域名匹配：精确相等或者是子域。
 *
 * 注意**不能**用 `endsWith(domain)` —— `evil-example.com`.endsWith('example.com')
 * 是 true，那样授权 example.com 等于把整个 *-example.com 都授权了。
 * 必须带上点号边界。
 */
function hostMatches(host: string, domain: string): boolean {
  const h = host.toLowerCase();
  const d = domain.toLowerCase();
  return h === d || h.endsWith(`.${d}`);
}

/** 从 URL 取 hostname（不含端口）。域名黑白名单匹配用。 */
export function hostOf(url: string | undefined): string {
  if (!url) return '';
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return '';
  }
}

/**
 * Official MCP netloc for ONCE grants: `new URL(url).host` (hostname + port).
 * Must match grantPermission({type:"netloc", netloc:e.host}, ONCE, …).
 */
export function netlocOf(url: string | undefined): string {
  if (!url) return '';
  try {
    return new URL(url).host.toLowerCase();
  } catch {
    return '';
  }
}

/**
 * 注册表级的可注入性检查。
 *
 * 和 CDP 的 isAttachableUrl 分开是有意的：那个管的是"技术上能不能 attach"，
 * 这个管的是"策略上该不该动"。比如扩展自己的页面技术上能 attach，但绝不该让
 * 模型去点自己的授权按钮 —— 那是权限提升。
 */
const NEVER_OPERABLE = [
  /^chrome:\/\//i,
  /^chrome-extension:\/\//i,
  /^chrome-untrusted:\/\//i,
  /^devtools:\/\//i,
  /^edge:\/\//i,
  /^about:/i,
  /^view-source:/i,
  /^file:\/\//i,
  /^https:\/\/chromewebstore\.google\.com/i,
  /^https:\/\/chrome\.google\.com\/webstore/i,
];

export function isOperableUrl(url: string | undefined): boolean {
  if (!url) return false;
  return !NEVER_OPERABLE.some((re) => re.test(url));
}

export class PermissionManager {
  /** Official MCP empty PM — never auto-allow from chat always/skip/turn storage. */
  private readonly isolated: boolean;

  /** 当前 turn id。换 turn 时 turn 级授权作废。 */
  private turnId = '';

  /** 永久授权（写 storage.local） — unused when isolated. */
  private granted: GrantMap = {};

  /** 本 turn 授权：`${host}:${permission}` — unused when isolated. */
  private turnGrants = new Set<string>();

  /** 本 turn 拒绝：同上。拒绝比同意更持久 —— 见类注释规则 2。 */
  private turnDenials = new Set<string>();

  /**
   * Official qI.ONCE grants keyed by toolUseId (MCP grant-then-retry).
   * Value: hostnames (netloc only — official grant has no permission type).
   */
  private onceByToolUseId = new Map<string, Set<string>>();

  /** 用户在设置里明确拉黑的域名 */
  private deniedDomains: string[] = [];

  /** 只允许在这些域名工作；空数组 = 不限制 */
  private allowedDomains: string[] = [];

  /**
   * Official domain_transition always grants (persisted).
   * Key form: `${fromDomain}→${toDomain}` lowercased hosts.
   */
  private domainTransitions = new Set<string>();

  /**
   * Turn-scoped domain_transition allows (Continue once).
   * Same key form as domainTransitions.
   */
  private turnDomainTransitions = new Set<string>();

  /** Turn-scoped domain_transition denies (Stop) — do not re-prompt same pair. */
  private turnDomainTransitionDenials = new Set<string>();

  /**
   * Official `follow_a_plan` gate (HG / C.current):
   * until the user approves an update_plan this turn, acting tools are blocked.
   */
  private planApprovedThisTurn = false;

  /** 待用户回答的请求：toolUseId → resolve */
  private pending = new Map<
    string,
    {
      resolve: (r: { granted: boolean; scope: PermissionScope }) => void;
      permission: Permission;
      host: string;
      fromDomain?: string;
      toDomain?: string;
    }
  >();

  constructor(opts: PermissionManagerOptions = {}) {
    this.isolated = Boolean(opts.isolated);
  }

  async init(): Promise<void> {
    const s = peekSettings();
    this.deniedDomains = s.deniedDomains ?? [];
    this.allowedDomains = s.allowedDomains ?? [];
    if (this.isolated) {
      // Official empty PM: do not load chat always / turn grants.
      this.granted = {};
      this.turnGrants.clear();
      this.domainTransitions.clear();
      return;
    }
    this.granted = await get<GrantMap>(STORAGE_KEYS.GRANTED_PERMISSIONS, {});
    const turn = await get<string[]>(SESSION_KEYS.TURN_APPROVED, [], 'session');
    this.turnGrants = new Set(turn);
    const transitions = await get<DomainTransitionGrant[]>(STORAGE_KEYS.DOMAIN_TRANSITIONS, []);
    this.domainTransitions = new Set(
      transitions.map((t) => domainTransitionKey(t.fromDomain, t.toDomain)).filter(Boolean),
    );
  }

  /** 新一轮对话开始。turn 级授权和拒绝都清空。 */
  async startTurn(turnId: string): Promise<void> {
    this.turnId = turnId;
    this.turnGrants.clear();
    this.turnDenials.clear();
    this.turnDomainTransitions.clear();
    this.turnDomainTransitionDenials.clear();
    this.planApprovedThisTurn = false;
    this.onceByToolUseId.clear();
    if (!this.isolated) {
      await set(SESSION_KEYS.TURN_APPROVED, [], 'session');
    }
    // 设置可能被改过（用户在配置页加了黑名单），每轮重读
    const s = peekSettings();
    this.deniedDomains = s.deniedDomains ?? [];
    this.allowedDomains = s.allowedDomains ?? [];
  }

  /** Official checkDomainTransition(from, to) — same-origin free; else prompt jZ card. */
  checkDomainTransition(fromDomain: string, toDomain: string): PermissionDecision {
    const from = normalizeDomainToken(fromDomain);
    const to = normalizeDomainToken(toDomain);
    if (!from || !to || from === to) {
      return { allowed: true, needsPrompt: false };
    }
    // Denied destination blocks without prompt.
    if (this.deniedDomains.some((d) => hostMatches(to, d))) {
      return {
        allowed: false,
        needsPrompt: false,
        reason: `${to} is on the deny list.`,
      };
    }
    if (this.allowedDomains.length > 0 && !this.allowedDomains.some((d) => hostMatches(to, d))) {
      return {
        allowed: false,
        needsPrompt: false,
        reason: `${to} is not on the allow list.`,
      };
    }
    const key = domainTransitionKey(from, to);
    if (this.turnDomainTransitionDenials.has(key)) {
      return {
        allowed: false,
        needsPrompt: false,
        reason: `The user declined navigation from ${from} to ${to}. Do not retry this transition.`,
      };
    }
    if (this.domainTransitions.has(key) || this.turnDomainTransitions.has(key)) {
      return { allowed: true, needsPrompt: false };
    }
    return {
      allowed: false,
      needsPrompt: true,
      reason: `Navigation from ${from} to ${to} needs confirmation.`,
    };
  }

  grantDomainTransition(fromDomain: string, toDomain: string, permanent: boolean): void {
    const key = domainTransitionKey(fromDomain, toDomain);
    if (!key) return;
    if (permanent && !this.isolated) {
      this.domainTransitions.add(key);
      void this.persistDomainTransitions();
    } else {
      this.turnDomainTransitions.add(key);
    }
  }

  async revokeDomainTransition(fromDomain: string, toDomain: string): Promise<void> {
    const key = domainTransitionKey(fromDomain, toDomain);
    this.domainTransitions.delete(key);
    this.turnDomainTransitions.delete(key);
    await this.persistDomainTransitions();
  }

  listDomainTransitions(): DomainTransitionGrant[] {
    return [...this.domainTransitions].map((k) => {
      const [fromDomain = '', toDomain = ''] = k.split('\u2192');
      return { fromDomain, toDomain };
    });
  }

  private async persistDomainTransitions(): Promise<void> {
    await set(
      STORAGE_KEYS.DOMAIN_TRANSITIONS,
      this.listDomainTransitions(),
    );
  }

  /**
   * Official grantPermission({type:"netloc", netloc}, ONCE, toolUseId, origin).
   * Scope is **netloc-only** (URL.host, may include port — no permission type).
   * findApplicablePermission matches toolUseId + netloc and consumes on first hit.
   */
  grantOnce(toolUseId: string, netloc: string, _permission?: Permission): void {
    if (!toolUseId || !netloc) return;
    const h = netloc.toLowerCase();
    const setFor = this.onceByToolUseId.get(toolUseId) ?? new Set<string>();
    setFor.add(h);
    this.onceByToolUseId.set(toolUseId, setFor);
  }

  /** Drop ONCE grants for a finished tool_use (or all if id omitted). */
  clearOnceGrants(toolUseId?: string): void {
    if (toolUseId) this.onceByToolUseId.delete(toolUseId);
    else this.onceByToolUseId.clear();
  }

  get currentTurnId(): string {
    return this.turnId;
  }

  /** Official: plan approved for this turn (C.current = true). */
  get planApproved(): boolean {
    return this.planApprovedThisTurn;
  }

  /**
   * After the user approves update_plan:
   *  - mark plan gate open
   *  - grant ordinary browse/click/type/read permissions for listed domains
   *    for the rest of this turn (irreversible / JS / upload still prompt)
   */
  async approvePlan(domains: string[]): Promise<void> {
    this.planApprovedThisTurn = true;
    const ordinary: Permission[] = [
      PERMISSION.READ_PAGE_CONTENT,
      PERMISSION.CLICK,
      PERMISSION.TYPE,
      PERMISSION.NAVIGATE,
      PERMISSION.READ_CONSOLE_MESSAGES,
    ];
    for (const raw of domains) {
      const host = hostOf(raw.includes('://') ? raw : `https://${raw}`) || raw.toLowerCase();
      if (!host) continue;
      for (const perm of ordinary) {
        this.turnGrants.add(`${host}:${perm}`);
      }
    }
    await set(SESSION_KEYS.TURN_APPROVED, [...this.turnGrants], 'session');
  }

  /** Turn ended without plan / user interrupted — mirror official C.current = false. */
  clearPlanApproval(): void {
    this.planApprovedThisTurn = false;
  }

  /**
   * 核心判定。
   *
   * 返回 `needsPrompt: true` 时，**调用方必须**把 permission_required 抛给侧栏，
   * 拿到用户回答后再调 `resolve()`，然后重试。工具层不允许自己"当作允许"继续。
   */
  check(url: string, permission: Permission, opts: CheckOptions = {}): PermissionDecision {
    const host = hostOf(url);
    // Official ONCE netloc is URL.host (may include port); domain lists use hostname.
    const netloc = netlocOf(url) || host;

    /*
     * update_plan / PLAN_APPROVAL is not a page action — official eS has no page URL.
     * requestPermission often passes url:'' which used to hard-fail isOperableUrl/!host
     * and never show the plan card. Always prompt; never sticky-deny the whole turn
     * (model must be able to re-plan after "Make changes").
     */
    if (permission === PERMISSION.PLAN_APPROVAL) {
      return {
        allowed: false,
        needsPrompt: true,
        reason: 'Plan approval always requires an explicit user decision in the side panel.',
      };
    }

    if (!isOperableUrl(url)) {
      return {
        allowed: false,
        needsPrompt: false,
        reason:
          `This page (${url || 'unknown'}) cannot be operated on. ` +
          `Browser-internal pages, the extension's own pages, and the Chrome Web Store are off limits. ` +
          `Ask the user to switch to a regular website tab.`,
      };
    }

    if (!host && !netloc) {
      return {
        allowed: false,
        needsPrompt: false,
        reason: `Could not determine the host for ${url}. Navigate to a normal https:// page first.`,
      };
    }

    // 黑名单优先于一切，包括已有的永久授权。
    if (host && this.deniedDomains.some((d) => hostMatches(host, d))) {
      return {
        allowed: false,
        needsPrompt: false,
        reason: `The user has blocked this extension from operating on ${host}. Do not retry; tell the user instead.`,
      };
    }

    // 白名单模式：设了 allowedDomains 就只在里面工作。
    if (
      host &&
      this.allowedDomains.length > 0 &&
      !this.allowedDomains.some((d) => hostMatches(host, d))
    ) {
      return {
        allowed: false,
        needsPrompt: false,
        reason:
          `${host} is outside the list of sites the user allowed this extension to work on. ` +
          `Do not retry; tell the user they can add it in the extension settings.`,
      };
    }

    const key = `${host || netloc}:${permission}`;

    // Official MCP ONCE: toolUseId + netloc (URL.host) match, then consume.
    // Also accept legacy hostname-only grants written before this parity fix.
    if (opts.toolUseId && netloc) {
      const once = this.onceByToolUseId.get(opts.toolUseId);
      if (once?.has(netloc) || (host && once?.has(host))) {
        once.delete(netloc);
        if (host) once.delete(host);
        if (once.size === 0) this.onceByToolUseId.delete(opts.toolUseId);
        return { allowed: true, needsPrompt: false };
      }
    }

    // 本 turn 已经被拒过就别再问了 —— 反复弹窗是一种胁迫。
    if (this.turnDenials.has(key)) {
      return {
        allowed: false,
        needsPrompt: false,
        reason:
          `The user already declined "${permission}" on ${host} during this turn. ` +
          `Do not ask again; either work around it or tell the user what you need.`,
      };
    }

    const settings = peekSettings();

    // 高危场景：跳过所有缓存，每次都问。
    const irreversible = looksIrreversible(opts.actionLabel);
    const sensitive = isSensitiveHost(host);
    // JS / upload / network 永远不能被 "Act without asking" 静默放行
    // (PLAN_APPROVAL already returned above.)
    const neverSkip =
      permission === PERMISSION.EXECUTE_JAVASCRIPT ||
      permission === PERMISSION.UPLOAD_IMAGE ||
      permission === PERMISSION.READ_NETWORK_REQUESTS;
    const mustAsk =
      opts.force ||
      (!this.isolated && settings.forcePrompt) ||
      irreversible ||
      sensitive ||
      neverSkip;

    /*
     * Official open-MCP empty PM (`new WN(() => !1, {})`):
     * never auto-allow from chat always / turn storage / "Act without asking".
     * Only ONCE grants (above) or an explicit prompt.
     */
    if (this.isolated) {
      return {
        allowed: false,
        needsPrompt: true,
        reason: irreversible
          ? `"${opts.actionLabel}" looks irreversible, so it needs fresh confirmation.`
          : sensitive
            ? `${host} handles money or credentials, so every action needs confirmation.`
            : neverSkip
              ? `"${permission}" always needs confirmation and cannot be auto-approved.`
              : undefined,
      };
    }

    if (!mustAsk) {
      if (this.turnGrants.has(key)) return { allowed: true, needsPrompt: false };
      if ((this.granted[host] ?? []).includes(permission)) {
        return { allowed: true, needsPrompt: false };
      }
      /*
       * "Act without asking"：对常规动作自动放行。
       * 这是原版 composer 左下角那个切换的语义 —— 不是关掉权限系统，
       * 而是把"普通浏览/点击/输入"从显式气泡降级成静默同意。
       * 黑名单 / 不可操作 URL 已经在上面 return 了，走不到这里。
       */
      if (settings.permissionMode === 'skip') {
        return { allowed: true, needsPrompt: false };
      }
    }

    return {
      allowed: false,
      needsPrompt: true,
      reason: irreversible
        ? `"${opts.actionLabel}" looks irreversible, so it needs fresh confirmation even if this site was approved before.`
        : sensitive
          ? `${host} handles money or credentials, so every action needs confirmation.`
          : neverSkip
            ? `"${permission}" always needs confirmation and cannot be auto-approved.`
            : undefined,
    };
  }

  /**
   * 登记一个待回答的授权请求，返回一个 Promise。
   *
   * 工具 await 这个 Promise —— 也就是说 agent loop 在等用户时是真的挂起的，
   * 不会"先执行再问"。这点很重要：先执行的授权 UI 是假的授权 UI。
   */
  waitFor(
    toolUseId: string,
    permission: Permission,
    host: string,
    extra: { fromDomain?: string; toDomain?: string } = {},
  ): Promise<{ granted: boolean; scope: PermissionScope }> {
    return new Promise((resolve) => {
      this.pending.set(toolUseId, {
        resolve,
        permission,
        host,
        fromDomain: extra.fromDomain,
        toDomain: extra.toDomain,
      });
    });
  }

  /** 用户在侧栏点了允许/拒绝。 */
  async resolve(
    toolUseId: string,
    granted: boolean,
    scope: PermissionScope = 'once',
  ): Promise<void> {
    const entry = this.pending.get(toolUseId);
    if (!entry) return;
    this.pending.delete(toolUseId);

    const key = `${entry.host}:${entry.permission}`;

    if (granted) {
      // Official jZ: Continue → once (turn), Always continue → permanent pair.
      if (entry.permission === PERMISSION.DOMAIN_TRANSITION) {
        const from = entry.fromDomain ?? '';
        const to = entry.toDomain ?? entry.host;
        // Chat: permanent always lands on disk; MCP isolated: turn-only (popup is once).
        this.grantDomainTransition(from, to, scope === 'always' && !this.isolated);
        entry.resolve({ granted, scope });
        return;
      }
      // Official empty MCP PM: only ONCE via grantOnce(toolUseId) on retry —
      // never sticky turn/always from the popup boolean response.
      if (!this.isolated) {
        if (scope === 'turn' || scope === 'domain') {
          this.turnGrants.add(key);
          await set(SESSION_KEYS.TURN_APPROVED, [...this.turnGrants], 'session');
        }
        // "always" 需要落盘，但有些权限不允许永久授权。
        if (scope === 'always' || scope === 'domain') {
          if (NO_PERSISTENT_GRANT.has(entry.permission)) {
            // 降级成 turn 级，并且不写盘。用户看到的是"已允许"，
            // 实际下次会话还会再问 —— 这是有意的保守行为。
            this.turnGrants.add(key);
            await set(SESSION_KEYS.TURN_APPROVED, [...this.turnGrants], 'session');
          } else if (scope === 'always') {
            const list = this.granted[entry.host] ?? [];
            if (!list.includes(entry.permission)) {
              this.granted[entry.host] = [...list, entry.permission];
              await set(STORAGE_KEYS.GRANTED_PERMISSIONS, this.granted);
            }
          }
        }
      }
    } else if (entry.permission === PERMISSION.DOMAIN_TRANSITION) {
      const from = entry.fromDomain ?? '';
      const to = entry.toDomain ?? entry.host;
      const dk = domainTransitionKey(from, to);
      if (dk) this.turnDomainTransitionDenials.add(dk);
    } else if (entry.permission !== PERMISSION.PLAN_APPROVAL) {
      // Chat: sticky deny for the turn. Official MCP ONCE deny does not sticky
      // (denyPermission returns early for ONCE) — next tool_request may re-prompt.
      if (!this.isolated) {
        this.turnDenials.add(key);
      }
    }

    entry.resolve({ granted, scope });
  }

  /** 有没有正在等用户回答的请求（UI 用来禁用输入框）。 */
  hasPending(): boolean {
    return this.pending.size > 0;
  }

  /** turn 被用户中断时，把所有挂起的请求当作拒绝解开，避免 Promise 永久悬挂。 */
  abortAll(): void {
    for (const [id, entry] of this.pending) {
      if (entry.permission === PERMISSION.DOMAIN_TRANSITION) {
        // Pair deny so the same from→to is not re-prompted after abort/stop.
        const from = entry.fromDomain ?? '';
        const to = entry.toDomain ?? entry.host;
        const dk = domainTransitionKey(from, to);
        if (dk) this.turnDomainTransitionDenials.add(dk);
      } else if (!this.isolated) {
        // Chat sticky-denies; official MCP ONCE deny does not.
        this.turnDenials.add(`${entry.host}:${entry.permission}`);
      }
      entry.resolve({ granted: false, scope: 'once' });
      this.pending.delete(id);
    }
  }

  /** 撤销某个域名的所有永久授权（设置页用）。 */
  async revokeHost(host: string): Promise<void> {
    delete this.granted[host];
    await set(STORAGE_KEYS.GRANTED_PERMISSIONS, this.granted);
    for (const k of [...this.turnGrants]) {
      if (k.startsWith(`${host}:`)) this.turnGrants.delete(k);
    }
    await set(SESSION_KEYS.TURN_APPROVED, [...this.turnGrants], 'session');
  }

  async revokeAll(): Promise<void> {
    this.granted = {};
    this.turnGrants.clear();
    this.domainTransitions.clear();
    this.turnDomainTransitions.clear();
    this.turnDomainTransitionDenials.clear();
    await set(STORAGE_KEYS.GRANTED_PERMISSIONS, {});
    await set(STORAGE_KEYS.DOMAIN_TRANSITIONS, []);
    await set(SESSION_KEYS.TURN_APPROVED, [], 'session');
  }

  /** 设置页展示用。 */
  listGrants(): Array<{ host: string; permissions: Permission[] }> {
    return Object.entries(this.granted).map(([host, permissions]) => ({ host, permissions }));
  }
}

/** Official domain pair key (arrow U+2192). */
export function domainTransitionKey(fromDomain: string, toDomain: string): string {
  const from = normalizeDomainToken(fromDomain);
  const to = normalizeDomainToken(toDomain);
  if (!from || !to) return '';
  return `${from}\u2192${to}`;
}

function normalizeDomainToken(raw: string | undefined): string {
  if (!raw) return '';
  let s = raw.trim().toLowerCase();
  // Official strips a trailing dot before port: example.com. → example.com
  s = s.replace(/\.(?=(:\d+)?$)/, '');
  try {
    if (s.includes('://')) return new URL(s).hostname.toLowerCase();
  } catch {
    /* fall through */
  }
  // host:port → host for domain lists
  return s.replace(/:\d+$/, '');
}

/** 单例。侧栏和 SW 各有一份（不同 JS 上下文），靠 storage 保持一致。 */
export const permissionManager = new PermissionManager();

/**
 * Official open-MCP permission manager: empty sticky grants, ONCE-only after allow.
 * Lives only in the service worker with the native bridge (not the sidepanel).
 */
export const mcpPermissionManager = new PermissionManager({ isolated: true });

/** 供 UI 展示：这个权限允许哪些授权范围。 */
export function availableScopes(permission: Permission): PermissionScope[] {
  if (NO_PERSISTENT_GRANT.has(permission)) return ['once', 'turn'];
  if (permission === PERMISSION.PLAN_APPROVAL) return ['once'];
  // Official jZ: Continue (once) + Always continue (always) — no turn row.
  if (permission === PERMISSION.DOMAIN_TRANSITION) return ['once', 'always'];
  return ['once', 'turn', 'always'];
}
