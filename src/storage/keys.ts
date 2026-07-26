/**
 * chrome.storage key 枚举 + 读写封装。
 *
 * 分区原则：
 *  - local：体积大 / 机密（API Key、会话历史、权限授权记录）
 *  - session：只活在这次浏览器会话（当前 turn 的授权、CDP attach 记录）
 *
 * 不用 sync：API Key 同步到 Google 账号不合适，会话历史也会超 sync 配额。
 */

export const STORAGE_KEYS = {
  /** Settings 对象 */
  SETTINGS: 'settings',
  /** Record<host, Permission[]> —— "always" 级别的持久授权 */
  GRANTED_PERMISSIONS: 'grantedPermissions',
  /** string[] —— 用户明确拒绝过的域名 */
  DENIED_DOMAINS: 'deniedDomains',
  /** Record<conversationId, StoredConversation> */
  CONVERSATIONS: 'conversations',
  /** 最近打开的会话 id */
  ACTIVE_CONVERSATION: 'activeConversationId',
  /** 模型列表缓存 { models: string[], fetchedAt: number } */
  MODELS_CACHE: 'modelsCache',
  /** 首次安装是否已经引导过 */
  ONBOARDED: 'onboarded',
} as const;

export const SESSION_KEYS = {
  /** 本轮（turn）内已授权的 host，跨轮不继承 */
  TURN_APPROVED: 'turnApprovedDomains',
  /** 当前 debugger attach 的 tabId 列表，用于 SW 重启后清理 */
  ATTACHED_TABS: 'attachedTabs',
} as const;

type StorageArea = 'local' | 'session';

function area(a: StorageArea): chrome.storage.StorageArea {
  return a === 'session' ? chrome.storage.session : chrome.storage.local;
}

export async function get<T>(key: string, fallback: T, a: StorageArea = 'local'): Promise<T> {
  const res = await area(a).get(key);
  const v = res[key];
  return v === undefined ? fallback : (v as T);
}

export async function set(key: string, value: unknown, a: StorageArea = 'local'): Promise<void> {
  await area(a).set({ [key]: value });
}

export async function remove(key: string, a: StorageArea = 'local'): Promise<void> {
  await area(a).remove(key);
}

/**
 * 只在值真的变了时才写。
 *
 * 为什么重要：storage 写入会触发 onChanged，进而触发 React 重渲染。
 * 无脑写同样的值会让侧栏在每次工具调用后闪一下，严重时把 UI 打进死循环。
 */
export async function setIfChanged(
  key: string,
  value: unknown,
  a: StorageArea = 'local',
): Promise<boolean> {
  const cur = (await area(a).get(key))[key];
  if (JSON.stringify(cur) === JSON.stringify(value)) return false;
  await area(a).set({ [key]: value });
  return true;
}
