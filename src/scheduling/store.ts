/**
 * Light schedule MVP: queue prompts when sidepanel is open; notify when closed.
 */

export interface Schedule {
  id: string;
  /** human label */
  title: string;
  prompt: string;
  /** every N minutes (minimum 1). For once-shots, still used as delay. */
  everyMinutes: number;
  /**
   * Official convert frequency `once`: fire once then disable (no periodInMinutes).
   */
  once?: boolean;
  enabled: boolean;
  tabUrl?: string;
  nextRun: number;
  createdAt: number;
}

const KEY = 'schedules';
export const ALARM_PREFIX = 'agent_sched_';

function uid(): string {
  return `sch_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export async function listSchedules(): Promise<Schedule[]> {
  const raw = await chrome.storage.local.get(KEY);
  return (raw[KEY] as Schedule[] | undefined) ?? [];
}

export async function saveSchedules(items: Schedule[]): Promise<void> {
  await chrome.storage.local.set({ [KEY]: items });
}

export async function createSchedule(input: {
  title: string;
  prompt: string;
  everyMinutes: number;
  tabUrl?: string;
  /** Official frequency once — single fire, then auto-disable. */
  once?: boolean;
}): Promise<Schedule> {
  const items = await listSchedules();
  const everyMinutes = Math.max(1, Math.round(input.everyMinutes));
  const now = Date.now();
  const s: Schedule = {
    id: uid(),
    title: input.title,
    prompt: input.prompt,
    everyMinutes,
    once: Boolean(input.once),
    enabled: true,
    tabUrl: input.tabUrl,
    nextRun: now + everyMinutes * 60_000,
    createdAt: now,
  };
  items.push(s);
  await saveSchedules(items);
  await syncAlarm(s);
  return s;
}

export async function deleteSchedule(id: string): Promise<boolean> {
  const items = await listSchedules();
  const next = items.filter((s) => s.id !== id);
  if (next.length === items.length) return false;
  await saveSchedules(next);
  try {
    await chrome.alarms.clear(ALARM_PREFIX + id);
  } catch {
    /* ignore */
  }
  return true;
}

export async function setScheduleEnabled(id: string, enabled: boolean): Promise<Schedule | null> {
  const items = await listSchedules();
  const s = items.find((x) => x.id === id);
  if (!s) return null;
  s.enabled = enabled;
  if (enabled) s.nextRun = Date.now() + s.everyMinutes * 60_000;
  await saveSchedules(items);
  if (enabled) await syncAlarm(s);
  else {
    try {
      await chrome.alarms.clear(ALARM_PREFIX + id);
    } catch {
      /* ignore */
    }
  }
  return s;
}

export async function syncAlarm(s: Schedule): Promise<void> {
  const name = ALARM_PREFIX + s.id;
  try {
    await chrome.alarms.clear(name);
  } catch {
    /* ignore */
  }
  if (!s.enabled) return;
  // Chrome alarms: periodInMinutes min is 1 for recurring.
  // Official frequency once → delay only (no period); handler disables after fire.
  if (s.once) {
    await chrome.alarms.create(name, {
      delayInMinutes: Math.max(1, s.everyMinutes),
    });
  } else {
    await chrome.alarms.create(name, {
      delayInMinutes: Math.max(1, s.everyMinutes),
      periodInMinutes: Math.max(1, s.everyMinutes),
    });
  }
}

export async function resyncAllAlarms(): Promise<void> {
  const items = await listSchedules();
  for (const s of items) {
    if (s.enabled) await syncAlarm(s);
  }
}

export async function getScheduleByAlarmName(name: string): Promise<Schedule | undefined> {
  if (!name.startsWith(ALARM_PREFIX)) return undefined;
  const id = name.slice(ALARM_PREFIX.length);
  const items = await listSchedules();
  return items.find((s) => s.id === id);
}

/** Pending prompts for the open sidepanel to pick up. */
const QUEUE_KEY = 'schedule_queue';

export interface QueuedPrompt {
  id: string;
  scheduleId: string;
  title: string;
  prompt: string;
  queuedAt: number;
}

export async function enqueuePrompt(q: Omit<QueuedPrompt, 'id' | 'queuedAt'>): Promise<void> {
  const raw = await chrome.storage.session.get(QUEUE_KEY);
  const list = (raw[QUEUE_KEY] as QueuedPrompt[] | undefined) ?? [];
  list.push({ ...q, id: uid(), queuedAt: Date.now() });
  await chrome.storage.session.set({ [QUEUE_KEY]: list });
}

export async function drainQueue(): Promise<QueuedPrompt[]> {
  const raw = await chrome.storage.session.get(QUEUE_KEY);
  const list = (raw[QUEUE_KEY] as QueuedPrompt[] | undefined) ?? [];
  if (list.length) await chrome.storage.session.set({ [QUEUE_KEY]: [] });
  return list;
}

/**
 * 把未消费的队列项放回队头（保留相对顺序）。
 * drain 后若 agent 正忙或只取了第一条，必须用这个把剩余项写回，
 * 否则会丢任务。
 */
export async function requeueFront(items: QueuedPrompt[]): Promise<void> {
  if (items.length === 0) return;
  const raw = await chrome.storage.session.get(QUEUE_KEY);
  const existing = (raw[QUEUE_KEY] as QueuedPrompt[] | undefined) ?? [];
  // 按 id 去重，避免 storage 事件重入时叠两份
  const seen = new Set(items.map((i) => i.id));
  const tail = existing.filter((e) => !seen.has(e.id));
  await chrome.storage.session.set({ [QUEUE_KEY]: [...items, ...tail] });
}
