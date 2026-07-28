/**
 * Claude tab-group lifecycle (official ME / createGroup subset).
 *
 * Official: on sidepanel open, if the anchored tab is not already in a managed
 * group, put it in its own orange group titled "Claude". Secondary tabs in the
 * same Chrome group show a hand-off screen instead of the full chat.
 *
 * We keep metadata under the same storage key as official (`tabGroups`) so a
 * reload can re-attach without inventing a parallel system.
 */

const STORAGE_KEY = 'tabGroups';
const GROUP_TITLE = 'Claude';

export type GroupMeta = {
  mainTabId: number;
  chromeGroupId: number;
  createdAt: number;
  domain: string;
};

type StoredMap = Record<string, GroupMeta>;

async function loadMap(): Promise<Map<number, GroupMeta>> {
  try {
    const raw = await chrome.storage.local.get(STORAGE_KEY);
    const obj = (raw[STORAGE_KEY] ?? {}) as StoredMap;
    const map = new Map<number, GroupMeta>();
    for (const [k, v] of Object.entries(obj)) {
      const id = Number(k);
      if (!Number.isFinite(id) || !v || typeof v.chromeGroupId !== 'number') continue;
      map.set(id, { ...v, mainTabId: v.mainTabId ?? id });
    }
    return map;
  } catch {
    return new Map();
  }
}

async function saveMap(map: Map<number, GroupMeta>): Promise<void> {
  const obj: StoredMap = {};
  for (const [k, v] of map) obj[String(k)] = v;
  await chrome.storage.local.set({ [STORAGE_KEY]: obj });
}

function domainOf(url: string | undefined): string {
  if (!url || url.startsWith('chrome://')) return 'blank';
  try {
    return new URL(url).hostname || 'blank';
  } catch {
    return 'blank';
  }
}

async function groupTabAlone(tabId: number): Promise<number> {
  const tab = await chrome.tabs.get(tabId);
  return chrome.tabs.group({
    tabIds: [tabId],
    createProperties: { windowId: tab.windowId },
  });
}

/**
 * Ensure `tabId` is the main tab of an orange "Claude" group.
 * Returns metadata, or null if tabGroups API / tab is unavailable.
 */
export async function ensureClaudeGroup(tabId: number): Promise<GroupMeta | null> {
  if (!chrome.tabGroups || tabId < 0) return null;

  try {
    const map = await loadMap();
    const existing = map.get(tabId);
    if (existing) {
      try {
        await chrome.tabGroups.get(existing.chromeGroupId);
        return existing;
      } catch {
        map.delete(tabId);
      }
    }

    // Already a member of someone else's managed group?
    for (const meta of map.values()) {
      try {
        const members = await chrome.tabs.query({ groupId: meta.chromeGroupId });
        if (members.some((t) => t.id === tabId)) {
          return meta;
        }
      } catch {
        /* group gone */
      }
    }

    const tab = await chrome.tabs.get(tabId);
    if (!tab.id) return null;

    // Leave a non-Claude group so we can create an isolated one (official).
    if (
      tab.groupId !== undefined &&
      tab.groupId !== chrome.tabGroups.TAB_GROUP_ID_NONE
    ) {
      const owned = [...map.values()].some((m) => m.chromeGroupId === tab.groupId);
      if (!owned) {
        try {
          await chrome.tabs.ungroup([tabId]);
        } catch {
          /* may already be ungrouped */
        }
      } else {
        // In a managed Claude group as secondary — don't re-create.
        const main = [...map.values()].find((m) => m.chromeGroupId === tab.groupId);
        return main ?? null;
      }
    }

    let chromeGroupId: number | undefined;
    let attempts = 3;
    while (attempts > 0) {
      try {
        chromeGroupId = await groupTabAlone(tabId);
        break;
      } catch {
        attempts -= 1;
        if (attempts === 0) throw new Error('Failed to create Chrome tab group');
        await new Promise((r) => setTimeout(r, 100));
      }
    }
    if (chromeGroupId === undefined) return null;

    await chrome.tabGroups.update(chromeGroupId, {
      title: GROUP_TITLE,
      color: chrome.tabGroups.Color.ORANGE,
      collapsed: false,
    });

    const meta: GroupMeta = {
      mainTabId: tabId,
      chromeGroupId,
      createdAt: Date.now(),
      domain: domainOf(tab.url),
    };
    map.set(tabId, meta);
    await saveMap(map);
    return meta;
  } catch {
    return null;
  }
}

export type GroupRole =
  | { kind: 'ungrouped' }
  | { kind: 'main'; meta: GroupMeta }
  | { kind: 'secondary'; meta: GroupMeta; mainTabId: number };

/** Classify the current tab relative to managed Claude groups. */
export async function classifyTab(tabId: number): Promise<GroupRole> {
  if (!chrome.tabGroups) return { kind: 'ungrouped' };
  try {
    const map = await loadMap();
    const asMain = map.get(tabId);
    if (asMain) {
      try {
        await chrome.tabGroups.get(asMain.chromeGroupId);
        return { kind: 'main', meta: asMain };
      } catch {
        map.delete(tabId);
        await saveMap(map);
      }
    }

    const tab = await chrome.tabs.get(tabId);
    const gid = tab.groupId;
    if (gid === undefined || gid === chrome.tabGroups.TAB_GROUP_ID_NONE) {
      return { kind: 'ungrouped' };
    }

    for (const meta of map.values()) {
      if (meta.chromeGroupId === gid) {
        return { kind: 'secondary', meta, mainTabId: meta.mainTabId };
      }
    }

    // Unmanaged group with title Claude — treat as adopt-able main.
    try {
      const g = await chrome.tabGroups.get(gid);
      if (g.title === GROUP_TITLE || g.title?.startsWith('Claude')) {
        const meta: GroupMeta = {
          mainTabId: tabId,
          chromeGroupId: gid,
          createdAt: Date.now(),
          domain: domainOf(tab.url),
        };
        map.set(tabId, meta);
        await saveMap(map);
        return { kind: 'main', meta };
      }
    } catch {
      /* */
    }

    return { kind: 'ungrouped' };
  } catch {
    return { kind: 'ungrouped' };
  }
}

/** Switch to the main tab of a group and ask the SW to open its side panel. */
export async function openMainTabChat(mainTabId: number): Promise<void> {
  try {
    await chrome.tabs.update(mainTabId, { active: true });
    const t = await chrome.tabs.get(mainTabId);
    if (t.windowId !== undefined) {
      await chrome.windows.update(t.windowId, { focused: true });
      await chrome.sidePanel.open({ tabId: mainTabId, windowId: t.windowId }).catch(() => {
        /* already open / gesture */
      });
    }
  } catch {
    /* tab may be gone */
  }
}

/** Official status emoji on the Chrome tab-group title (ME.updateTabGroupPrefix). */
const TITLE_PREFIX_RE = /^(⌛|🔔|✅)/;

async function findMetaForTab(tabId: number): Promise<GroupMeta | null> {
  const map = await loadMap();
  const asMain = map.get(tabId);
  if (asMain) {
    try {
      await chrome.tabGroups.get(asMain.chromeGroupId);
      return asMain;
    } catch {
      map.delete(tabId);
      await saveMap(map);
    }
  }
  try {
    const tab = await chrome.tabs.get(tabId);
    const gid = tab.groupId;
    if (gid === undefined || gid === chrome.tabGroups.TAB_GROUP_ID_NONE) return null;
    for (const meta of map.values()) {
      if (meta.chromeGroupId === gid) return meta;
    }
  } catch {
    /* */
  }
  return null;
}

/**
 * Official updateTabGroupPrefix(mainTabId, nextPrefix | null, onlyIfCurrent?).
 * Prefixes are glued to the bare title: `🔔Claude`, `⌛Claude`, `✅Claude`.
 */
async function updateTabGroupPrefix(
  tabId: number,
  next: '⌛' | '🔔' | '✅' | null,
  onlyIfCurrent?: '⌛' | '🔔' | '✅',
): Promise<void> {
  if (!chrome.tabGroups) return;
  const meta = await findMetaForTab(tabId);
  if (!meta) return;

  let attempt = 0;
  const run = async (): Promise<void> => {
    try {
      const g = await chrome.tabGroups.get(meta.chromeGroupId);
      const title = g.title || GROUP_TITLE;
      if (onlyIfCurrent && !title.startsWith(onlyIfCurrent)) return;
      if (next && title.startsWith(next)) return;
      if (!next && !TITLE_PREFIX_RE.test(title)) return;
      const bare = title.replace(TITLE_PREFIX_RE, '').trim() || GROUP_TITLE;
      const nextTitle = next ? `${next}${bare}` : bare;
      await chrome.tabGroups.update(meta.chromeGroupId, { title: nextTitle });
    } catch {
      attempt += 1;
      if (attempt <= 3) {
        await new Promise((r) => setTimeout(r, 500));
        return run();
      }
    }
  };
  await run();
}

/** Running / streaming — hourglass on the group chip. */
export async function addLoadingPrefix(tabId: number): Promise<void> {
  await updateTabGroupPrefix(tabId, '⌛');
}

/** Waiting on a permission card — bell on the group chip (what users notice). */
export async function addPermissionPrefix(tabId: number): Promise<void> {
  await updateTabGroupPrefix(tabId, '🔔');
}

/** Turn finished successfully — checkmark. */
export async function addCompletionPrefix(tabId: number): Promise<void> {
  await updateTabGroupPrefix(tabId, '✅');
}

/** Drop a completion mark when the user starts a new turn (official). */
export async function removeCompletionPrefix(tabId: number): Promise<void> {
  await updateTabGroupPrefix(tabId, null, '✅');
}

/** Clear any status emoji (clear chat / stop). */
export async function removeGroupPrefix(tabId: number): Promise<void> {
  await updateTabGroupPrefix(tabId, null);
}
