/**
 * GIF 录制状态。按 tab group（或单 tab）隔离，最多 50 帧。
 * 帧在侧栏内存；关掉侧栏即丢。
 */

export interface GifFrame {
  jpegBase64: string;
  label: string;
  ts: number;
  width: number;
  height: number;
}

export interface GifSession {
  key: string;
  recording: boolean;
  frames: GifFrame[];
  startedAt: number;
}

const MAX_FRAMES = 50;
const sessions = new Map<string, GifSession>();

export function groupKey(opts: { groupId?: number; tabId: number }): string {
  if (opts.groupId !== undefined && opts.groupId !== -1) return `group:${opts.groupId}`;
  return `tab:${opts.tabId}`;
}

function getOrCreate(key: string): GifSession {
  let s = sessions.get(key);
  if (!s) {
    s = { key, recording: false, frames: [], startedAt: Date.now() };
    sessions.set(key, s);
  }
  return s;
}

export function startRecording(key: string): GifSession {
  const s = getOrCreate(key);
  s.recording = true;
  s.startedAt = Date.now();
  if (s.frames.length === 0) {
    /* keep existing frames until clear */
  }
  return s;
}

export function stopRecording(key: string): GifSession {
  const s = getOrCreate(key);
  s.recording = false;
  return s;
}

export function clearRecording(key: string): void {
  sessions.delete(key);
}

export function isRecording(key: string): boolean {
  return sessions.get(key)?.recording === true;
}

export function getSession(key: string): GifSession | undefined {
  return sessions.get(key);
}

/** 任意 group key 是否在录制（computer 钩子用）。 */
export function anyRecordingKeyForTab(tabId: number, groupId?: number): string | null {
  const keys = [groupKey({ tabId, groupId }), `tab:${tabId}`];
  for (const k of keys) {
    if (isRecording(k)) return k;
  }
  // also scan all
  for (const [k, s] of sessions) {
    if (s.recording && (k === `tab:${tabId}` || (groupId !== undefined && k === `group:${groupId}`))) {
      return k;
    }
  }
  return null;
}

export function pushFrame(
  key: string,
  frame: Omit<GifFrame, 'ts'>,
): { ok: true; count: number } | { ok: false; error: string } {
  const s = sessions.get(key);
  if (!s?.recording) {
    return { ok: false, error: 'Not recording. Call gif_creator with action start_recording first.' };
  }
  if (s.frames.length >= MAX_FRAMES) {
    return {
      ok: false,
      error: `Frame limit reached (${MAX_FRAMES}). Stop recording and export, or clear.`,
    };
  }
  s.frames.push({ ...frame, ts: Date.now() });
  return { ok: true, count: s.frames.length };
}

export function listFrameSummary(key: string): string {
  const s = sessions.get(key);
  if (!s) return 'No GIF session.';
  return (
    `recording=${s.recording}, frames=${s.frames.length}/${MAX_FRAMES}` +
    (s.frames.length
      ? `\n` + s.frames.map((f, i) => `  ${i + 1}. ${f.label} (${f.width}x${f.height})`).join('\n')
      : '')
  );
}

export const GIF_MAX_FRAMES = MAX_FRAMES;
