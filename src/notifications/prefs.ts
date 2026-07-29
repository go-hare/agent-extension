/**
 * Notification preference (official `notificationsEnabled` storage key).
 *
 * Values:
 *  - undefined → never asked → show BM banner above composer
 *  - 'enabled' → fire chrome.notifications when a turn completes / needs input
 *  - 'disabled' → user dismissed the banner; do not show again
 */

export const NOTIFICATIONS_ENABLED_KEY = 'notificationsEnabled';

export type NotificationsPref = 'enabled' | 'disabled' | undefined;

export async function loadNotificationsPref(): Promise<NotificationsPref> {
  try {
    const raw = await chrome.storage.local.get(NOTIFICATIONS_ENABLED_KEY);
    const v = raw[NOTIFICATIONS_ENABLED_KEY];
    if (v === 'enabled' || v === 'disabled') return v;
    return undefined;
  } catch {
    return undefined;
  }
}

export async function setNotificationsPref(
  value: 'enabled' | 'disabled',
): Promise<void> {
  await chrome.storage.local.set({ [NOTIFICATIONS_ENABLED_KEY]: value });
}

/** OS / Chrome notification when a turn finishes (official gt path). */
export async function notifyTaskDone(opts: {
  title: string;
  message: string;
}): Promise<void> {
  try {
    await chrome.runtime.sendMessage({
      type: 'SHOW_NOTIFICATION',
      title: opts.title,
      message: opts.message,
    });
  } catch {
    try {
      await chrome.notifications.create({
        type: 'basic',
        iconUrl: chrome.runtime.getURL('public/icons/icon-128.png'),
        title: opts.title,
        message: opts.message,
        priority: 2,
      });
    } catch {
      /* blocked / unavailable */
    }
  }
  // Sound is triggered by SW on SHOW_NOTIFICATION (offscreen OFFSCREEN_PLAY_SOUND).
}
