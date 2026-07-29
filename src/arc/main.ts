/**
 * Arc browser entry — open side panel when possible, else options.
 * Official arc.html loads a local request bootstrap; we only need a thin shell.
 */

import '@/styles/theme.css';
import { bootstrapTheme } from '@/sidepanel/theme';

bootstrapTheme();

async function boot(): Promise<void> {
  try {
    // Prefer opening the side panel in the current window.
    const win = await chrome.windows.getCurrent();
    if (win.id != null) {
      await chrome.sidePanel.open({ windowId: win.id });
    }
  } catch {
    try {
      await chrome.runtime.openOptionsPage();
    } catch {
      /* ignore */
    }
  }

  // Close this helper tab after a short beat (official also tears down).
  setTimeout(() => {
    chrome.tabs.getCurrent((tab) => {
      if (tab?.id != null) {
        void chrome.tabs.remove(tab.id).catch(() => {});
      }
    });
  }, 400);
}

void boot();
