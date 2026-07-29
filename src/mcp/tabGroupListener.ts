/**
 * MCP tab-group hygiene — official ME.startTabGroupChangeListener subset.
 *
 * On mcp_connected, official starts a groupId change subscription that:
 *  - hides agent indicators when a tab leaves a managed group
 *  - detaches CDP for tabs that leave the MCP / session groups
 *  - clears stale mcpTabGroupId when the yellow group is dissolved
 *
 * Only tabs / groups we have tracked (yellow Claude (MCP) + session groups
 * used by the bridge) get detach/hide on leave — random ungroups elsewhere
 * must not tear down debuggers.
 */

import { hideIndicator } from '@/tools/tabs';
import { detach } from '@/cdp/session';
import { MCP_GROUP_TITLE } from './group';

const MCP_GROUP_KEY = 'mcpTabGroupId';

let started = false;
let onUpdated: Parameters<typeof chrome.tabs.onUpdated.addListener>[0] | null = null;
let onRemoved: Parameters<typeof chrome.tabs.onRemoved.addListener>[0] | null = null;
let onGroupRemoved: ((group: chrome.tabGroups.TabGroup) => void) | null = null;

/** Tabs currently known to sit in a managed MCP / session group. */
const mcpTabIds = new Set<number>();
/** Group ids we manage (shared yellow + session_scope groups). */
const managedGroupIds = new Set<number>();

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

async function onTabLeftMcpGroup(tabId: number): Promise<void> {
  mcpTabIds.delete(tabId);
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
  if (managedGroupIds.has(groupId)) return true;
  const stored = await loadMcpGroupId();
  if (stored === groupId) {
    managedGroupIds.add(groupId);
    return true;
  }
  try {
    const g = await chrome.tabGroups.get(groupId);
    if (
      g.color === chrome.tabGroups.Color.YELLOW &&
      g.title?.includes(MCP_GROUP_TITLE)
    ) {
      managedGroupIds.add(groupId);
      return true;
    }
  } catch {
    /* ignore */
  }
  return false;
}

/** Seed membership from the shared yellow MCP group in storage. */
async function refreshMcpTabMembership(): Promise<void> {
  const groupId = await loadMcpGroupId();
  if (groupId == null) return;
  managedGroupIds.add(groupId);
  try {
    const tabs = await chrome.tabs.query({ groupId });
    for (const t of tabs) {
      if (t.id != null) mcpTabIds.add(t.id);
    }
  } catch {
    /* group gone */
  }
}

export function startMcpTabGroupListener(): void {
  if (started || !chrome.tabs?.onUpdated) return;
  started = true;
  void refreshMcpTabMembership();

  onUpdated = (tabId, change, _tab) => {
    if (!('groupId' in change)) return;
    const next = change.groupId;
    void (async () => {
      try {
        if (next != null && next !== chrome.tabGroups.TAB_GROUP_ID_NONE) {
          if (await isMcpManagedGroup(next)) {
            mcpTabIds.add(tabId);
            return;
          }
        }

        // Left a managed group — only clean if we previously tracked this tab.
        if (mcpTabIds.has(tabId)) {
          await onTabLeftMcpGroup(tabId);
        }
      } catch {
        /* ignore */
      }
    })();
  };

  onRemoved = (tabId) => {
    if (mcpTabIds.has(tabId)) {
      void onTabLeftMcpGroup(tabId);
    } else {
      mcpTabIds.delete(tabId);
    }
  };

  onGroupRemoved = (group) => {
    void (async () => {
      await clearMcpGroupIdIf(group.id);
      managedGroupIds.delete(group.id);
      // Members of a dissolved managed group leave — clean known tabs by
      // re-querying is unnecessary; drop all tracked tabs that no longer exist
      // is handled by onRemoved. For dissolved group, clear any still-tracked
      // tabs that were only in this group by best-effort: if group was managed,
      // refresh won't re-add them.
      if (
        group.color === chrome.tabGroups.Color.YELLOW ||
        managedGroupIds.size === 0
      ) {
        /* membership rebuild on next start / track call */
      }
    })();
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
  mcpTabIds.clear();
  managedGroupIds.clear();
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

/** Mark a tab (and optional group) as MCP/session-managed for leave cleanup. */
export function trackMcpTab(tabId: number, groupId?: number): void {
  if (tabId >= 0) mcpTabIds.add(tabId);
  if (groupId != null && groupId !== chrome.tabGroups.TAB_GROUP_ID_NONE) {
    managedGroupIds.add(groupId);
  }
}
