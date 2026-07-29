/**
 * Light schedule MVP aligned with Claude in Chrome 1.0.81 alarms:
 *  - once → chrome.alarms.create({ when }) then disable after fire
 *  - daily/weekly → when + periodInMinutes
 *  - monthly/annually → when only, reschedule after each fire
 *
 * When sidepanel is open: enqueue prompt. When closed: SW opens a task window
 * (official EXECUTE_SCHEDULED_TASK path).
 */

export type ScheduleFrequency = 'once' | 'daily' | 'weekly' | 'monthly' | 'annually';

export interface Schedule {
  id: string;
  /** human label */
  title: string;
  prompt: string;
  /**
   * Fallback delay minutes (legacy + convert once without datetime).
   * Minimum 1 for chrome.alarms delayInMinutes.
   */
  everyMinutes: number;
  /** Official repeatType (once | daily | weekly | monthly | annually). */
  frequency: ScheduleFrequency;
  /**
   * Official convert frequency `once`: fire once then disable (no periodInMinutes).
   * Kept for callers; derived from frequency === 'once' when omitted.
   */
  once?: boolean;
  enabled: boolean;
  tabUrl?: string;
  nextRun: number;
  createdAt: number;
  /** Official specificTime "HH:mm" (24h). */
  specificTime?: string;
  /** Official once: specificDate "YYYY-MM-DD". */
  specificDate?: string;
  /** Official weekly: 0=Sun … 6=Sat. */
  dayOfWeek?: number;
  /** Official monthly: 1–31. */
  dayOfMonth?: number;
  /** Official annually: "MM-DD". */
  monthAndDay?: string;
  /** Raw datetime from convert XML (ISO or free text). */
  datetime?: string;
}

const KEY = 'schedules';
export const ALARM_PREFIX = 'agent_sched_';

function uid(): string {
  return `sch_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Serialize schedule mutations — chrome.storage list→push→save races drop rows
 * under concurrent createSchedule (convert + Options + alarm paths).
 */
let scheduleChain: Promise<unknown> = Promise.resolve();

function withScheduleLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = scheduleChain.then(fn, fn);
  // Keep the chain alive even if this op rejects.
  scheduleChain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

export async function listSchedules(): Promise<Schedule[]> {
  const raw = await chrome.storage.local.get(KEY);
  const items = (raw[KEY] as Schedule[] | undefined) ?? [];
  // Migrate pre-frequency rows.
  return items.map((s) => {
    if (s.frequency) return s;
    const frequency: ScheduleFrequency = s.once ? 'once' : 'daily';
    return { ...s, frequency, once: frequency === 'once' || Boolean(s.once) };
  });
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
  frequency?: ScheduleFrequency;
  specificTime?: string;
  specificDate?: string;
  dayOfWeek?: number;
  dayOfMonth?: number;
  monthAndDay?: string;
  datetime?: string;
}): Promise<Schedule> {
  return withScheduleLock(async () => {
    const items = await listSchedules();
    const everyMinutes = Math.max(1, Math.round(input.everyMinutes));
    const now = Date.now();
    const frequency: ScheduleFrequency =
      input.frequency ?? (input.once ? 'once' : 'daily');
    const parsed = parseDatetimeFields(input.datetime, frequency);
    const s: Schedule = {
      id: uid(),
      title: input.title,
      prompt: input.prompt,
      everyMinutes,
      frequency,
      once: frequency === 'once',
      enabled: true,
      tabUrl: input.tabUrl,
      nextRun: now + everyMinutes * 60_000,
      createdAt: now,
      specificTime: input.specificTime ?? parsed.specificTime,
      specificDate: input.specificDate ?? parsed.specificDate,
      dayOfWeek: input.dayOfWeek ?? parsed.dayOfWeek,
      dayOfMonth: input.dayOfMonth ?? parsed.dayOfMonth,
      monthAndDay: input.monthAndDay ?? parsed.monthAndDay,
      datetime: input.datetime,
    };
    // If datetime gave an absolute next fire, prefer it for nextRun.
    const when = computeNextWhen(s, now);
    if (when != null) s.nextRun = when;
    items.push(s);
    await saveSchedules(items);
    await syncAlarm(s);
    // syncAlarm may refine nextRun — persist again.
    await saveSchedules(items);
    return s;
  });
}

export async function deleteSchedule(id: string): Promise<boolean> {
  return withScheduleLock(async () => {
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
  });
}

export async function setScheduleEnabled(id: string, enabled: boolean): Promise<Schedule | null> {
  return withScheduleLock(async () => {
    const items = await listSchedules();
    const s = items.find((x) => x.id === id);
    if (!s) return null;
    s.enabled = enabled;
    if (enabled) {
      const when = computeNextWhen(s, Date.now());
      s.nextRun = when ?? Date.now() + s.everyMinutes * 60_000;
    }
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
  });
}

/**
 * Official updateAlarmForPrompt — clear + create with `when` (+ period for daily/weekly).
 * monthly/annually: when only (reschedule after fire).
 */
export async function syncAlarm(s: Schedule): Promise<void> {
  const name = ALARM_PREFIX + s.id;
  try {
    await chrome.alarms.clear(name);
  } catch {
    /* ignore */
  }
  if (!s.enabled) return;

  const now = Date.now();
  const when = computeNextWhen(s, now);

  if (when != null && when > now) {
    const freq = s.frequency ?? (s.once ? 'once' : 'daily');
    if (freq === 'daily') {
      await chrome.alarms.create(name, { when, periodInMinutes: 1440 });
    } else if (freq === 'weekly') {
      await chrome.alarms.create(name, { when, periodInMinutes: 10080 });
    } else {
      // once | monthly | annually — absolute when, no period
      await chrome.alarms.create(name, { when });
    }
    s.nextRun = when;
    return;
  }

  // Fallback: delay-based (legacy / missing calendar fields)
  const delay = Math.max(1, s.everyMinutes);
  if (s.once || s.frequency === 'once') {
    await chrome.alarms.create(name, { delayInMinutes: delay });
  } else if (s.frequency === 'monthly' || s.frequency === 'annually') {
    await chrome.alarms.create(name, { delayInMinutes: delay });
  } else {
    await chrome.alarms.create(name, {
      delayInMinutes: delay,
      periodInMinutes: Math.max(1, s.everyMinutes),
    });
  }
  s.nextRun = now + delay * 60_000;
}

/** After monthly/annually fire, recompute next occurrence (official path). */
export async function rescheduleAfterFire(id: string): Promise<void> {
  return withScheduleLock(async () => {
    const items = await listSchedules();
    const s = items.find((x) => x.id === id);
    if (!s || !s.enabled) return;
    const freq = s.frequency ?? (s.once ? 'once' : 'daily');
    if (freq === 'once') {
      s.enabled = false;
      await saveSchedules(items);
      try {
        await chrome.alarms.clear(ALARM_PREFIX + id);
      } catch {
        /* ignore */
      }
      return;
    }
    if (freq === 'monthly' || freq === 'annually') {
      // Next occurrence must be strictly after now.
      const when = computeNextWhen(s, Date.now() + 60_000);
      if (when != null) s.nextRun = when;
      await saveSchedules(items);
      await syncAlarm(s);
    }
  });
}

export async function resyncAllAlarms(): Promise<void> {
  return withScheduleLock(async () => {
    const items = await listSchedules();
    for (const s of items) {
      if (s.enabled) await syncAlarm(s);
    }
    // Persist any nextRun updates from syncAlarm.
    await saveSchedules(items);
  });
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
  /** Target tab for scheduled window runs (optional). */
  tabUrl?: string;
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

// ── Calendar helpers (official updateAlarmForPrompt) ─────────────────

function parseTimeParts(specificTime?: string): { h: number; m: number } | null {
  if (!specificTime) return null;
  const m = specificTime.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h < 0 || h > 23 || min < 0 || min > 59) return null;
  return { h, m: min };
}

/**
 * Compute next absolute fire time (ms), or null if calendar fields insufficient.
 * `afterMs` — result must be > afterMs (exclusive for monthly/annually reschedule).
 */
export function computeNextWhen(s: Schedule, afterMs = Date.now()): number | null {
  const freq = s.frequency ?? (s.once ? 'once' : 'daily');
  const now = new Date(afterMs);
  const time = parseTimeParts(s.specificTime) ?? { h: now.getHours(), m: now.getMinutes() };

  switch (freq) {
    case 'once': {
      // Prefer specificDate + specificTime; else parse datetime ISO.
      if (s.specificDate) {
        const [y, mo, d] = s.specificDate.split('-').map(Number);
        if (!y || !mo || !d) return null;
        const c = new Date(y, mo - 1, d, time.h, time.m, 0, 0);
        return c.getTime() > afterMs ? c.getTime() : null;
      }
      if (s.datetime) {
        const t = Date.parse(s.datetime);
        if (!Number.isNaN(t) && t > afterMs) return t;
      }
      // Fallback: everyMinutes from now
      return afterMs + Math.max(1, s.everyMinutes) * 60_000;
    }
    case 'daily': {
      const e = new Date(now);
      e.setHours(time.h, time.m, 0, 0);
      if (e.getTime() <= afterMs) e.setDate(e.getDate() + 1);
      return e.getTime();
    }
    case 'weekly': {
      const dow =
        s.dayOfWeek !== undefined && s.dayOfWeek >= 0 && s.dayOfWeek <= 6
          ? s.dayOfWeek
          : now.getDay();
      let delta = (dow - now.getDay() + 7) % 7;
      if (delta === 0) {
        const today = new Date(now);
        today.setHours(time.h, time.m, 0, 0);
        if (today.getTime() <= afterMs) delta = 7;
      }
      const target = new Date(now);
      target.setDate(now.getDate() + delta);
      target.setHours(time.h, time.m, 0, 0);
      return target.getTime();
    }
    case 'monthly': {
      const day = s.dayOfMonth ?? now.getDate();
      let y = now.getFullYear();
      let mo = now.getMonth();
      let candidate = makeMonthDate(y, mo, day, time.h, time.m);
      if (candidate.getTime() <= afterMs) {
        mo += 1;
        if (mo > 11) {
          mo = 0;
          y += 1;
        }
        candidate = makeMonthDate(y, mo, day, time.h, time.m);
      }
      return candidate.getTime();
    }
    case 'annually': {
      let month = now.getMonth() + 1;
      let day = now.getDate();
      if (s.monthAndDay) {
        const [mm, dd] = s.monthAndDay.split('-').map(Number);
        if (mm && dd) {
          month = mm;
          day = dd;
        }
      }
      let y = now.getFullYear();
      let candidate = makeMonthDate(y, month - 1, day, time.h, time.m);
      if (candidate.getTime() <= afterMs) {
        candidate = makeMonthDate(y + 1, month - 1, day, time.h, time.m);
      }
      return candidate.getTime();
    }
    default:
      return null;
  }
}

function daysInMonth(year: number, monthIndex: number): number {
  return new Date(year, monthIndex + 1, 0).getDate();
}

function makeMonthDate(
  year: number,
  monthIndex: number,
  day: number,
  h: number,
  m: number,
): Date {
  const dim = daysInMonth(year, monthIndex);
  const d = Math.min(Math.max(1, day), dim);
  return new Date(year, monthIndex, d, h, m, 0, 0);
}

/** Infer official calendar fields from convert XML datetime + frequency. */
/**
 * Human-readable recurrence for Options list (official-ish).
 * Labels come from the UI layer — pass already-localized frequency words.
 */
export function formatScheduleSummary(
  s: Schedule,
  labels: {
    once: string;
    daily: string;
    weekly: string;
    monthly: string;
    annually: string;
    paused: string;
    everyMinutes: (n: number) => string;
    dayNames: string[];
  },
): string {
  const freq = s.frequency ?? (s.once ? 'once' : 'daily');
  const time = s.specificTime?.trim();
  const parts: string[] = [];
  switch (freq) {
    case 'once': {
      const date = s.specificDate?.trim();
      if (date && time) parts.push(`${labels.once} · ${date} ${time}`);
      else if (date) parts.push(`${labels.once} · ${date}`);
      else if (time) parts.push(`${labels.once} · ${time}`);
      else parts.push(labels.everyMinutes(s.everyMinutes));
      break;
    }
    case 'daily':
      parts.push(time ? `${labels.daily} · ${time}` : labels.daily);
      break;
    case 'weekly': {
      const name =
        s.dayOfWeek !== undefined && labels.dayNames[s.dayOfWeek]
          ? labels.dayNames[s.dayOfWeek]
          : '';
      parts.push(
        time
          ? `${labels.weekly}${name ? ` · ${name}` : ''} · ${time}`
          : `${labels.weekly}${name ? ` · ${name}` : ''}`,
      );
      break;
    }
    case 'monthly': {
      const dom = s.dayOfMonth ?? '';
      parts.push(
        time
          ? `${labels.monthly}${dom ? ` · ${dom}` : ''} · ${time}`
          : `${labels.monthly}${dom ? ` · ${dom}` : ''}`,
      );
      break;
    }
    case 'annually': {
      const md = s.monthAndDay ?? '';
      parts.push(
        time
          ? `${labels.annually}${md ? ` · ${md}` : ''} · ${time}`
          : `${labels.annually}${md ? ` · ${md}` : ''}`,
      );
      break;
    }
    default:
      parts.push(labels.everyMinutes(s.everyMinutes));
  }
  if (!s.enabled) parts.push(labels.paused);
  return parts.filter(Boolean).join(' ');
}

export function parseDatetimeFields(
  datetime: string | undefined,
  frequency: ScheduleFrequency,
): {
  specificTime?: string;
  specificDate?: string;
  dayOfWeek?: number;
  dayOfMonth?: number;
  monthAndDay?: string;
} {
  if (!datetime?.trim()) {
    // Defaults matching convert prompt: once → now+1h; recurring → 09:00
    if (frequency === 'once') {
      const t = new Date(Date.now() + 60 * 60_000);
      return {
        specificTime: padTime(t.getHours(), t.getMinutes()),
        specificDate: padDate(t),
      };
    }
    const now = new Date();
    return {
      specificTime: '09:00',
      dayOfWeek: now.getDay(),
      dayOfMonth: now.getDate(),
      monthAndDay: `${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`,
    };
  }

  const iso = Date.parse(datetime);
  if (!Number.isNaN(iso)) {
    const d = new Date(iso);
    const specificTime = padTime(d.getHours(), d.getMinutes());
    const specificDate = padDate(d);
    return {
      specificTime,
      specificDate,
      dayOfWeek: d.getDay(),
      dayOfMonth: d.getDate(),
      monthAndDay: `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`,
    };
  }

  // "YYYY-MM-DD HH:mm" / "YYYY-MM-DDTHH:mm"
  const m = datetime.match(
    /(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})/,
  );
  if (m) {
    const y = Number(m[1]);
    const mo = Number(m[2]);
    const day = Number(m[3]);
    const h = Number(m[4]);
    const min = Number(m[5]);
    const d = new Date(y, mo - 1, day, h, min, 0, 0);
    return {
      specificTime: padTime(h, min),
      specificDate: padDate(d),
      dayOfWeek: d.getDay(),
      dayOfMonth: day,
      monthAndDay: `${String(mo).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
    };
  }

  // Time only "HH:mm"
  const tm = datetime.match(/^(\d{1,2}):(\d{2})$/);
  if (tm) {
    return {
      specificTime: padTime(Number(tm[1]), Number(tm[2])),
      dayOfWeek: new Date().getDay(),
      dayOfMonth: new Date().getDate(),
      monthAndDay: `${String(new Date().getMonth() + 1).padStart(2, '0')}-${String(new Date().getDate()).padStart(2, '0')}`,
    };
  }

  return { specificTime: '09:00' };
}

function padTime(h: number, m: number): string {
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function padDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
