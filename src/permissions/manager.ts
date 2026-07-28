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

export interface CheckOptions {
  /** 动作文案，用来判断是不是不可逆操作 */
  actionLabel?: string;
  /**
   * 强制重新询问，忽略所有缓存。
   * 用于模型明显要做高风险动作、或者用户开了 forcePrompt。
   */
  force?: boolean;
}

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

/** 从 URL 取 host。取不到（about:blank 之类）返回空串。 */
export function hostOf(url: string | undefined): string {
  if (!url) return '';
  try {
    return new URL(url).hostname.toLowerCase();
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
  /** 当前 turn id。换 turn 时 turn 级授权作废。 */
  private turnId = '';

  /** 永久授权（写 storage.local） */
  private granted: GrantMap = {};

  /** 本 turn 授权：`${host}:${permission}` */
  private turnGrants = new Set<string>();

  /** 本 turn 拒绝：同上。拒绝比同意更持久 —— 见类注释规则 2。 */
  private turnDenials = new Set<string>();

  /** 用户在设置里明确拉黑的域名 */
  private deniedDomains: string[] = [];

  /** 只允许在这些域名工作；空数组 = 不限制 */
  private allowedDomains: string[] = [];

  /**
   * Official `follow_a_plan` gate (HG / C.current):
   * until the user approves an update_plan this turn, acting tools are blocked.
   */
  private planApprovedThisTurn = false;

  /** 待用户回答的请求：toolUseId → resolve */
  private pending = new Map<
    string,
    { resolve: (r: { granted: boolean; scope: PermissionScope }) => void; permission: Permission; host: string }
  >();

  async init(): Promise<void> {
    this.granted = await get<GrantMap>(STORAGE_KEYS.GRANTED_PERMISSIONS, {});
    const s = peekSettings();
    this.deniedDomains = s.deniedDomains ?? [];
    this.allowedDomains = s.allowedDomains ?? [];
    const turn = await get<string[]>(SESSION_KEYS.TURN_APPROVED, [], 'session');
    this.turnGrants = new Set(turn);
  }

  /** 新一轮对话开始。turn 级授权和拒绝都清空。 */
  async startTurn(turnId: string): Promise<void> {
    this.turnId = turnId;
    this.turnGrants.clear();
    this.turnDenials.clear();
    this.planApprovedThisTurn = false;
    await set(SESSION_KEYS.TURN_APPROVED, [], 'session');
    // 设置可能被改过（用户在配置页加了黑名单），每轮重读
    const s = peekSettings();
    this.deniedDomains = s.deniedDomains ?? [];
    this.allowedDomains = s.allowedDomains ?? [];
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

    if (!host) {
      return {
        allowed: false,
        needsPrompt: false,
        reason: `Could not determine the host for ${url}. Navigate to a normal https:// page first.`,
      };
    }

    // 黑名单优先于一切，包括已有的永久授权。
    if (this.deniedDomains.some((d) => hostMatches(host, d))) {
      return {
        allowed: false,
        needsPrompt: false,
        reason: `The user has blocked this extension from operating on ${host}. Do not retry; tell the user instead.`,
      };
    }

    // 白名单模式：设了 allowedDomains 就只在里面工作。
    if (this.allowedDomains.length > 0 && !this.allowedDomains.some((d) => hostMatches(host, d))) {
      return {
        allowed: false,
        needsPrompt: false,
        reason:
          `${host} is outside the list of sites the user allowed this extension to work on. ` +
          `Do not retry; tell the user they can add it in the extension settings.`,
      };
    }

    const key = `${host}:${permission}`;

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
      opts.force || settings.forcePrompt || irreversible || sensitive || neverSkip;

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
  ): Promise<{ granted: boolean; scope: PermissionScope }> {
    return new Promise((resolve) => {
      this.pending.set(toolUseId, { resolve, permission, host });
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
    } else if (entry.permission !== PERMISSION.PLAN_APPROVAL) {
      // Plan rejection must not sticky-deny re-planning this turn.
      this.turnDenials.add(key);
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
      this.turnDenials.add(`${entry.host}:${entry.permission}`);
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
    await set(STORAGE_KEYS.GRANTED_PERMISSIONS, {});
    await set(SESSION_KEYS.TURN_APPROVED, [], 'session');
  }

  /** 设置页展示用。 */
  listGrants(): Array<{ host: string; permissions: Permission[] }> {
    return Object.entries(this.granted).map(([host, permissions]) => ({ host, permissions }));
  }
}

/** 单例。侧栏和 SW 各有一份（不同 JS 上下文），靠 storage 保持一致。 */
export const permissionManager = new PermissionManager();

/** 供 UI 展示：这个权限允许哪些授权范围。 */
export function availableScopes(permission: Permission): PermissionScope[] {
  if (NO_PERSISTENT_GRANT.has(permission)) return ['once', 'turn'];
  if (permission === PERMISSION.PLAN_APPROVAL) return ['once'];
  return ['once', 'turn', 'always'];
}
