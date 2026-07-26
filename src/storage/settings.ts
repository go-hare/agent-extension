import { DEFAULT_SETTINGS, type Settings } from '@/shared/types';
import { STORAGE_KEYS, get, setIfChanged } from './keys';

let cache: Settings | null = null;

export async function loadSettings(): Promise<Settings> {
  const stored = await get<Partial<Settings>>(STORAGE_KEYS.SETTINGS, {});
  cache = { ...DEFAULT_SETTINGS, ...stored };
  return cache;
}

/**
 * 同步读缓存。
 *
 * 存在的理由：`chrome.sidePanel.open()` 必须在用户手势链里同步调用。
 * 一旦 await 了任何 Promise，手势就丢了，open 会被 Chrome 拒绝。
 * 所以 action.onClicked 里只能读这个同步缓存来决定「有没有 key」。
 * 缓存由 onChanged 监听保持新鲜。
 */
export function peekSettings(): Settings {
  return cache ?? DEFAULT_SETTINGS;
}

export function hasUsableCredentials(s: Settings = peekSettings()): boolean {
  return Boolean(s.apiKey && s.apiKey.trim() && s.apiBaseUrl && s.apiBaseUrl.trim());
}

export async function saveSettings(patch: Partial<Settings>): Promise<Settings> {
  const cur = cache ?? (await loadSettings());
  const next = { ...cur, ...patch };
  await setIfChanged(STORAGE_KEYS.SETTINGS, next);
  cache = next;
  return next;
}

/** 在每个上下文启动时调一次，保持 peekSettings() 新鲜。 */
export function watchSettings(onChange?: (s: Settings) => void): void {
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local') return;
    const c = changes[STORAGE_KEYS.SETTINGS];
    if (!c) return;
    cache = { ...DEFAULT_SETTINGS, ...(c.newValue as Partial<Settings>) };
    onChange?.(cache);
  });
}

/** 把用户填的 base 归一化成不带尾斜杠、不带 /v1 的形式。 */
export function normalizeBaseUrl(raw: string): string {
  let u = raw.trim();
  if (!u) return '';
  if (!/^https?:\/\//i.test(u)) u = `https://${u}`;
  u = u.replace(/\/+$/, '');
  u = u.replace(/\/v1$/i, '');
  return u;
}
