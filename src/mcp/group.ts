/**
 * Official MCP tab group ("Claude (MCP)") — parity with ME.getOrCreateMcpTabContext
 * in Claude in Chrome 1.0.81 (mcpPermissions).
 *
 * Official traits:
 *  - Title: "Claude (MCP)"
 *  - Color: YELLOW (not the classic orange "Claude" sidepanel group)
 *  - Seed URL: chrome://newtab (focused window)
 *  - Storage key: mcpTabGroupId
 *  - Recovery: if storage id is stale, find group by yellow + title includes name
 *  - ensureMcpGroupCharacteristics re-applies title/color if user renamed
 *
 * Sidepanel classic chat still uses ensureClaudeGroup ("Claude" / orange).
 */

const MCP_GROUP_KEY = 'mcpTabGroupId';
const MCP_CONNECTED_KEY = 'mcpConnected';
export const MCP_GROUP_TITLE = 'Claude (MCP)';

export async function setMcpConnected(connected: boolean): Promise<void> {
  await chrome.storage.local.set({ [MCP_CONNECTED_KEY]: connected });
}

export async function isMcpConnected(): Promise<boolean> {
  try {
    const raw = await chrome.storage.local.get(MCP_CONNECTED_KEY);
    return raw[MCP_CONNECTED_KEY] === true;
  } catch {
    return false;
  }
}

async function saveMcpGroupId(id: number | null): Promise<void> {
  if (id == null) {
    await chrome.storage.local.remove(MCP_GROUP_KEY);
    return;
  }
  await chrome.storage.local.set({ [MCP_GROUP_KEY]: id });
}

/**
 * Official findMcpTabGroupByCharacteristics:
 * yellow + title includes "Claude (MCP)" + has at least one tab.
 */
async function findMcpTabGroupByCharacteristics(): Promise<number | null> {
  if (!chrome.tabGroups) return null;
  try {
    const groups = await chrome.tabGroups.query({});
    for (const g of groups) {
      if (
        g.color === chrome.tabGroups.Color.YELLOW &&
        g.title?.includes(MCP_GROUP_TITLE)
      ) {
        const tabs = await chrome.tabs.query({ groupId: g.id });
        if (tabs.length > 0) return g.id;
      }
    }
  } catch {
    /* ignore */
  }
  return null;
}

async function loadMcpGroupId(): Promise<number | null> {
  try {
    const raw = await chrome.storage.local.get(MCP_GROUP_KEY);
    const id = raw[MCP_GROUP_KEY];
    if (typeof id === 'number') {
      try {
        await chrome.tabGroups.get(id);
        return id;
      } catch {
        /* stale id — fall through to characteristic search */
      }
    }
    const found = await findMcpTabGroupByCharacteristics();
    if (found != null) {
      await saveMcpGroupId(found);
      return found;
    }
    if (typeof id === 'number') await saveMcpGroupId(null);
    return null;
  } catch {
    return null;
  }
}

/** Official ensureMcpGroupCharacteristics */
async function ensureMcpGroupCharacteristics(groupId: number): Promise<void> {
  try {
    const g = await chrome.tabGroups.get(groupId);
    if (g.title !== MCP_GROUP_TITLE || g.color !== chrome.tabGroups.Color.YELLOW) {
      await chrome.tabGroups.update(groupId, {
        title: MCP_GROUP_TITLE,
        color: chrome.tabGroups.Color.YELLOW,
      });
    }
  } catch {
    /* group gone */
  }
}

export type McpTabInfo = {
  id: number;
  url: string;
  title: string;
  active: boolean;
};

export type McpTabContext = {
  tabGroupId: number;
  windowId: number;
  tabs: McpTabInfo[];
  created: boolean;
  /** Official field name used in tabContext payloads */
  currentTabId: number;
};

function mapTabs(members: chrome.tabs.Tab[]): McpTabInfo[] {
  return members
    .filter((t): t is chrome.tabs.Tab & { id: number } => typeof t.id === 'number')
    .map((t) => ({
      id: t.id,
      url: t.url ?? t.pendingUrl ?? '',
      title: t.title ?? '',
      active: Boolean(t.active),
    }));
}

/**
 * Official tabs_context_mcp core.
 * createIfEmpty → new focused window + yellow "Claude (MCP)" group with chrome://newtab.
 */
export async function getOrCreateMcpTabContext(opts?: {
  createIfEmpty?: boolean;
}): Promise<McpTabContext | null> {
  if (!chrome.tabGroups) return null;

  let groupId = await loadMcpGroupId();
  let created = false;

  if (groupId != null) {
    try {
      await chrome.tabGroups.get(groupId);
      await ensureMcpGroupCharacteristics(groupId);
      const members = await chrome.tabs.query({ groupId });
      if (members.length > 0) {
        const tabs = mapTabs(members);
        const windowId = members[0]!.windowId;
        const current =
          tabs.find((t) => t.active)?.id ?? tabs[0]!.id;
        return {
          tabGroupId: groupId,
          windowId,
          created: false,
          tabs,
          currentTabId: current,
        };
      }
      // Empty group — clear and fall through
      await saveMcpGroupId(null);
      groupId = null;
    } catch {
      await saveMcpGroupId(null);
      groupId = null;
    }
  }

  if (groupId == null && opts?.createIfEmpty) {
    // Official: chrome://newtab, focused: true
    const win = await chrome.windows.create({
      url: 'chrome://newtab',
      focused: true,
      type: 'normal',
    });
    if (!win?.id) {
      throw new Error('Failed to create MCP window/tab.');
    }
    const seed = win.tabs?.[0];
    if (!seed?.id) {
      throw new Error('Failed to create MCP window/tab.');
    }
    groupId = await chrome.tabs.group({
      tabIds: [seed.id],
      createProperties: { windowId: win.id },
    });
    await chrome.tabGroups.update(groupId, {
      title: MCP_GROUP_TITLE,
      color: chrome.tabGroups.Color.YELLOW,
      collapsed: false,
    });
    await saveMcpGroupId(groupId);
    created = true;

    return {
      tabGroupId: groupId,
      windowId: win.id,
      created,
      currentTabId: seed.id,
      tabs: [
        {
          id: seed.id,
          title: seed.title || 'New Tab',
          url: seed.url ?? seed.pendingUrl ?? 'chrome://newtab',
          active: true,
        },
      ],
    };
  }

  return null;
}

/** Stable color index for a session (official colorIndex; hash when Desktop omits it). */
export function sessionColorIndex(seed?: string): number {
  if (!seed) return 0;
  let h = 0;
  for (let i = 0; i < seed.length; i++) {
    h = (Math.imul(31, h) + seed.charCodeAt(i)) >>> 0;
  }
  return h;
}

const SESSION_COLORS: chrome.tabGroups.Color[] = [
  chrome.tabGroups.Color.BLUE,
  chrome.tabGroups.Color.CYAN,
  chrome.tabGroups.Color.GREEN,
  chrome.tabGroups.Color.ORANGE,
  chrome.tabGroups.Color.RED,
  chrome.tabGroups.Color.PINK,
  chrome.tabGroups.Color.PURPLE,
  chrome.tabGroups.Color.GREY,
];

/**
 * Session-scoped MCP groups (official getOrCreateSessionTabContext).
 * Used when Desktop/Claude Code sends session_scope with a per-conversation group.
 *
 * Window selection (official + multi-session tighten):
 *  1. Existing group with tabs → reuse that group/window
 *  2. Existing group empty but still valid → create seed tab in **that group's window**
 *     (avoid jumping to lastFocused personal window mid-session)
 *  3. Else official path: getLastFocused(normal) → create tab + group there
 *  4. No normal window → create unfocused window + group (official fallback)
 */
export async function getOrCreateSessionTabContext(
  tabGroupId: number | undefined,
  opts: {
    createIfEmpty?: boolean;
    displayName?: string;
    colorIndex?: number;
    /** Used to stabilize color when colorIndex omitted (sessionId / displayName). */
    sessionKey?: string;
  },
): Promise<McpTabContext | null> {
  if (!chrome.tabGroups) return null;

  /** Prefer this window when re-seeding an empty-but-valid group. */
  let stickyWindowId: number | undefined;

  if (tabGroupId != null) {
    try {
      const g = await chrome.tabGroups.get(tabGroupId);
      stickyWindowId = g.windowId;
      if (opts.displayName) {
        try {
          await chrome.tabGroups.update(tabGroupId, { title: opts.displayName });
        } catch {
          /* ignore */
        }
      }
      const members = await chrome.tabs.query({ groupId: tabGroupId });
      if (members.length > 0) {
        const tabs = mapTabs(members);
        return {
          tabGroupId,
          windowId: members[0]!.windowId,
          created: false,
          tabs,
          currentTabId: tabs.find((t) => t.active)?.id ?? tabs[0]!.id,
        };
      }
      // Group still exists but has no tabs — fall through createIfEmpty into stickyWindowId.
    } catch {
      stickyWindowId = undefined;
      /* create below if allowed */
    }
  }

  if (!opts.createIfEmpty) return null;

  const color =
    SESSION_COLORS[
      (opts.colorIndex ?? sessionColorIndex(opts.sessionKey ?? opts.displayName)) %
        SESSION_COLORS.length
    ] ?? chrome.tabGroups.Color.BLUE;
  const title = opts.displayName ?? 'Claude';

  // Official: last focused normal window; we prefer sticky session window first.
  let windowId: number | undefined = stickyWindowId;
  if (windowId != null) {
    try {
      await chrome.windows.get(windowId);
    } catch {
      windowId = undefined;
    }
  }
  if (windowId == null) {
    try {
      const last = await chrome.windows.getLastFocused({ windowTypes: ['normal'] });
      if (last?.id != null) windowId = last.id;
    } catch {
      /* create window */
    }
  }

  if (windowId == null) {
    const win = await chrome.windows.create({
      url: 'chrome://newtab/',
      focused: false,
      type: 'normal',
    });
    if (!win?.id || !win.tabs?.[0]?.id) {
      throw new Error('Failed to create fallback window for session group');
    }
    const seedId = win.tabs[0].id;
    // Prefer reusing the empty group id when Chrome still has it.
    let gid: number;
    if (tabGroupId != null && stickyWindowId === win.id) {
      try {
        await chrome.tabs.group({ tabIds: [seedId], groupId: tabGroupId });
        gid = tabGroupId;
      } catch {
        gid = await chrome.tabs.group({
          tabIds: [seedId],
          createProperties: { windowId: win.id },
        });
      }
    } else {
      gid = await chrome.tabs.group({
        tabIds: [seedId],
        createProperties: { windowId: win.id },
      });
    }
    await chrome.tabGroups.update(gid, { title, color, collapsed: false });
    return {
      tabGroupId: gid,
      windowId: win.id,
      created: true,
      currentTabId: seedId,
      tabs: [
        {
          id: seedId,
          title: 'New Tab',
          url: 'chrome://newtab/',
          active: true,
        },
      ],
    };
  }

  // If the empty group still exists in this window, add a seed tab into it
  // instead of minting a second group for the same session id.
  if (tabGroupId != null) {
    try {
      await chrome.tabGroups.get(tabGroupId);
      const tab = await chrome.tabs.create({
        windowId,
        url: 'chrome://newtab/',
        active: false,
      });
      if (tab.id == null) throw new Error('Failed to create tab for session group');
      try {
        await chrome.tabs.group({ tabIds: [tab.id], groupId: tabGroupId });
      } catch {
        try {
          await chrome.tabs.remove(tab.id);
        } catch {
          /* ignore */
        }
        // Fall through to create a fresh group below.
        throw new Error('reseed-failed');
      }
      if (opts.displayName) {
        try {
          await chrome.tabGroups.update(tabGroupId, { title: opts.displayName, color });
        } catch {
          /* ignore */
        }
      }
      return {
        tabGroupId,
        windowId,
        created: true,
        currentTabId: tab.id,
        tabs: [
          {
            id: tab.id,
            title: tab.title || 'New Tab',
            url: tab.url ?? tab.pendingUrl ?? 'chrome://newtab/',
            active: Boolean(tab.active),
          },
        ],
      };
    } catch {
      /* create new group */
    }
  }

  const tab = await chrome.tabs.create({
    windowId,
    url: 'chrome://newtab/',
    active: false,
  });
  if (tab.id == null) throw new Error('Failed to create tab for session group');
  const gid = await chrome.tabs.group({
    tabIds: [tab.id],
    createProperties: { windowId },
  });
  await chrome.tabGroups.update(gid, { title, color, collapsed: false });
  return {
    tabGroupId: gid,
    windowId,
    created: true,
    currentTabId: tab.id,
    tabs: [
      {
        id: tab.id,
        title: tab.title || 'New Tab',
        url: tab.url ?? tab.pendingUrl ?? 'chrome://newtab/',
        active: Boolean(tab.active),
      },
    ],
  };
}

/**
 * Resolve optional create URL for tabs_create_mcp.
 * - omit / empty → chrome://newtab (official seed)
 * - bare host → https://
 * - only http(s) allowed (no chrome:/javascript:/file:)
 */
export function resolveCreateMcpTabUrl(raw?: string | null): string {
  if (raw == null) return 'chrome://newtab';
  const trimmed = String(raw).trim();
  if (!trimmed) return 'chrome://newtab';
  const u = /^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`;
  if (!/^https?:\/\//i.test(u)) {
    throw new Error(
      `tabs_create_mcp url must be http:// or https:// (got "${trimmed}"). ` +
        `Omit url to open chrome://newtab.`,
    );
  }
  return u;
}

/** Create a tab inside the MCP / session group (tabs_create_mcp). */
export async function createMcpTab(
  tabGroupId?: number,
  url?: string | null,
): Promise<{
  tabId: number;
  tabGroupId: number;
  windowId: number;
  tabs: McpTabInfo[];
  url: string;
}> {
  let gid = tabGroupId;
  let windowId: number;

  if (gid != null) {
    try {
      ({ windowId } = await chrome.tabGroups.get(gid));
    } catch {
      throw new Error(
        "This session's tab group no longer exists (tabs were closed). Call tabs_context_mcp with createIfEmpty: true to create a new one.",
      );
    }
  } else {
    const ctx = await getOrCreateMcpTabContext({ createIfEmpty: false });
    if (!ctx?.tabGroupId) {
      throw new Error(
        'No MCP tab group exists. Use tabs_context_mcp with createIfEmpty: true first to create one.',
      );
    }
    gid = ctx.tabGroupId;
    try {
      ({ windowId } = await chrome.tabGroups.get(gid));
    } catch {
      throw new Error(
        'The MCP tab group no longer exists (tabs were closed). Call tabs_context_mcp with createIfEmpty: true to create a new one.',
      );
    }
  }

  const createUrl = resolveCreateMcpTabUrl(url);
  const tab = await chrome.tabs.create({
    windowId,
    active: false,
    url: createUrl,
  });
  if (tab.id == null) throw new Error('Failed to create tab - no tab ID returned');
  try {
    await chrome.tabs.group({ tabIds: [tab.id], groupId: gid });
  } catch (e) {
    // Do not leave an ungrouped personal tab as "MCP" — close and surface.
    try {
      await chrome.tabs.remove(tab.id);
    } catch {
      /* ignore */
    }
    throw new Error(
      e instanceof Error
        ? `Failed to add tab to MCP group: ${e.message}`
        : 'Failed to add tab to MCP group (group may have been closed). Call tabs_context_mcp with createIfEmpty: true first.',
    );
  }
  // Shared MCP group: persist id; session groups are caller-owned.
  if (tabGroupId == null) await saveMcpGroupId(gid);

  const members = await chrome.tabs.query({ groupId: gid });
  return {
    tabId: tab.id,
    tabGroupId: gid,
    windowId,
    tabs: mapTabs(members),
    url: createUrl,
  };
}

/** Close a tab only if it belongs to the MCP / given session group. */
export async function closeMcpTab(
  tabId: number,
  sessionTabGroupId?: number,
): Promise<void> {
  let groupId = sessionTabGroupId;
  if (groupId == null) {
    const ctx = await getOrCreateMcpTabContext({ createIfEmpty: false });
    if (!ctx) {
      throw new Error(
        'No MCP tab group exists. Nothing to close. Call tabs_context_mcp with createIfEmpty: true if you need a working tab.',
      );
    }
    groupId = ctx.tabGroupId;
  }

  let tab: chrome.tabs.Tab;
  try {
    tab = await chrome.tabs.get(tabId);
  } catch {
    throw new Error(
      `Tab ${tabId} does not exist (may have already been closed).`,
    );
  }
  if (tab.groupId !== groupId) {
    throw new Error(
      `Tab ${tabId} is not in the current MCP tab group. Call tabs_context_mcp for valid IDs.`,
    );
  }
  await chrome.tabs.remove(tabId);
}

/** Official-ish list formatter for tabs_context_mcp output. */
export function formatMcpTabsList(
  tabs: McpTabInfo[],
  tabGroupId: number,
  currentTabId?: number,
): string {
  if (tabs.length === 0) {
    return `MCP tab group ${tabGroupId} is empty.`;
  }
  const lines = [
    `MCP tab group ${tabGroupId} (${tabs.length} tab${tabs.length === 1 ? '' : 's'}):`,
    ...tabs.map((t) => {
      const marks: string[] = [];
      if (currentTabId != null && t.id === currentTabId) marks.push('current');
      if (t.active) marks.push('active');
      const suffix = marks.length ? ` (${marks.join(', ')})` : '';
      return `- tabId=${t.id}${suffix} title=${JSON.stringify(t.title)} url=${t.url || '(empty)'}`;
    }),
    'Use these tab IDs with other browser tools. Prefer tabs_create_mcp for a fresh tab per conversation.',
  ];
  return lines.join('\n');
}
