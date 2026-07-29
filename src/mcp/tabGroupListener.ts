/**
 * MCP tab-group hygiene — official ME.startTabGroupChangeListener subset.
 *
 * On mcp_connected, official starts a groupId change subscription that:
 *  - hides agent indicators when a tab leaves a managed group
 *  - detaches CDP for tabs that leave the MCP / session groups
 *  - clears stale mcpTabGroupId when the yellow group is dissolved
 *
 * We implement the MCP-scoped slice (not the full orange sidepanel regrouper).
 */

import { hideIndicator } from '@/tools/tabs';
import { detach } from '@/cdp/session';
import { MCP_GROUP_TITLE } from './group';

const MCP_GROUP_KEY = 'mcpTabGroupId';

let started = false;
let onUpdated: Parameters<typeof chrome.tabs.onUpdated.addListener>[0] | null = null;
let onRemoved: Parameters<typeof chrome.tabs.onRemoved.addListener>[0] | null = null;
let onGroupRemoved: ((group: chrome.tabGroups.TabGroup) => void) | null = null;

async function loadMcpGroupId(): Promise<number | null> {
  try {
    const raw = await chrome.storage.local.get(MCP_GROUP_KEY);
    const id = raw[MCP_GROUP_KEY];
    return typeof id === 'number' ? id : null;
  } catch {
    return null;
  }
}

async function clearMcpGroupIdIf(id: number): Promise<void> {
  const cur = await loadMcpGroupId();
  if (cur === id) {
    try {
      await chrome.storage.local.remove(MCP_GROUP_KEY);
    } catch {
      /* ignore */
    }
  }
}

/**
 * When a tab leaves the MCP yellow group (or any group whose title is Claude (MCP)),
 * hide indicators and detach debugger so the debug banner clears.
 */
async function onTabLeftMcpGroup(tabId: number): Promise<void> {
  try {
    await hideIndicator(tabId);
  } catch {
    /* ignore */
  }
  try {
    await detach(tabId);
  } catch {
    /* ignore */
  }
}

async function isMcpManagedGroup(groupId: number): Promise<boolean> {
  if (groupId === chrome.tabGroups.TAB_GROUP_ID_NONE) return false;
  const stored = await loadMcpGroupId();
  if (stored === groupId) return true;
  try {
    const g = await chrome.tabGroups.get(groupId);
    return Boolean(
      g.color === chrome.tabGroups.Color.YELLOW && g.title?.includes(MCP_GROUP_TITLE),
    );
  } catch {
    return false;
  }
}

export function startMcpTabGroupListener(): void {
  if (started || !chrome.tabs?.onUpdated) return;
  started = true;

  onUpdated = (tabId, change, tab) => {
    // Official AE subscribe filters on groupId changes.
    if (!('groupId' in change)) return;
    const next = change.groupId;
    void (async () => {
      try {
        // Left a group entirely, or moved to a non-MCP group.
        if (next === chrome.tabGroups.TAB_GROUP_ID_NONE || next == null) {
          // Only act if it *was* in MCP group — we don't have previous id in changeInfo,
          // so detach/hide is best-effort for any ungroup during an MCP session.
          await onTabLeftMcpGroup(tabId);
          return;
        }
        if (!(await isMcpManagedGroup(next))) {
          // Moved into some other group while MCP session may still be live.
          await onTabLeftMcpGroup(tabId);
          return;
        }
        // Joined / stayed in MCP group — ensure yellow title if it's the stored group.
        void tab;
      } catch {
        /* ignore */
      }
    })();
  };

  onRemoved = (tabId) => {
    void onTabLeftMcpGroup(tabId);
  };

  // Chrome fires onRemoved with the TabGroup that was removed (id still valid
  // on the object; the group is already gone from the browser).
  onGroupRemoved = (group) => {
    void clearMcpGroupIdIf(group.id);
  };

  chrome.tabs.onUpdated.addListener(onUpdated);
  chrome.tabs.onRemoved.addListener(onRemoved);
  try {
    chrome.tabGroups?.onRemoved?.addListener(onGroupRemoved);
  } catch {
    /* tabGroups may be missing */
  }
}

export function stopMcpTabGroupListener(): void {
  if (!started) return;
  started = false;
  if (onUpdated) {
    try {
      chrome.tabs.onUpdated.removeListener(onUpdated);
    } catch {
      /* ignore */
    }
    onUpdated = null;
  }
  if (onRemoved) {
    try {
      chrome.tabs.onRemoved.removeListener(onRemoved);
    } catch {
      /* ignore */
    }
    onRemoved = null;
  }
  if (onGroupRemoved) {
    try {
      chrome.tabGroups?.onRemoved?.removeListener(onGroupRemoved);
    } catch {
      /* ignore */
    }
    onGroupRemoved = null;
  }
}

export function isMcpTabGroupListenerStarted(): boolean {
  return started;
}
