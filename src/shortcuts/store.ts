/**
 * Shortcuts / workflows stored in chrome.storage.local.
 */

export interface Shortcut {
  id: string;
  command: string;
  title: string;
  description: string;
  prompt: string;
  skipPermissions?: boolean;
  model?: string;
  updatedAt: number;
}

const KEY = 'shortcuts';

const SEED: Omit<Shortcut, 'id' | 'updatedAt'>[] = [
  {
    command: 'summarize',
    title: 'Summarize page',
    description: 'Summarize the current page in a few bullets',
    prompt:
      'Read the current page (prefer get_page_text for articles, read_page for apps) and summarize it in 5 short bullets. Cite key facts only from what you actually read.',
  },
  {
    command: 'extract-links',
    title: 'Extract links',
    description: 'List main links on the page',
    prompt:
      'Use read_page or get_page_text to find the main navigational and content links on this page. Return a markdown list of title → URL. Skip ads and trackers when obvious.',
  },
];

function uid(): string {
  return `sc_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export async function listShortcuts(): Promise<Shortcut[]> {
  const raw = await chrome.storage.local.get(KEY);
  let items = (raw[KEY] as Shortcut[] | undefined) ?? [];
  if (items.length === 0) {
    items = SEED.map((s) => ({ ...s, id: uid(), updatedAt: Date.now() }));
    await chrome.storage.local.set({ [KEY]: items });
  }
  return items;
}

export async function saveShortcut(
  input: Omit<Shortcut, 'id' | 'updatedAt'> & { id?: string },
): Promise<Shortcut> {
  const items = await listShortcuts();
  const now = Date.now();
  if (input.id) {
    const idx = items.findIndex((s) => s.id === input.id);
    const next: Shortcut = {
      id: input.id,
      command: input.command.replace(/^\//, '').toLowerCase(),
      title: input.title,
      description: input.description,
      prompt: input.prompt,
      skipPermissions: input.skipPermissions,
      model: input.model,
      updatedAt: now,
    };
    if (idx >= 0) items[idx] = next;
    else items.push(next);
    await chrome.storage.local.set({ [KEY]: items });
    return next;
  }
  const created: Shortcut = {
    id: uid(),
    command: input.command.replace(/^\//, '').toLowerCase(),
    title: input.title,
    description: input.description,
    prompt: input.prompt,
    skipPermissions: input.skipPermissions,
    model: input.model,
    updatedAt: now,
  };
  items.push(created);
  await chrome.storage.local.set({ [KEY]: items });
  return created;
}

export async function deleteShortcut(id: string): Promise<boolean> {
  const items = await listShortcuts();
  const next = items.filter((s) => s.id !== id);
  if (next.length === items.length) return false;
  await chrome.storage.local.set({ [KEY]: next });
  return true;
}

export async function findShortcut(opts: {
  shortcutId?: string;
  command?: string;
}): Promise<Shortcut | undefined> {
  const items = await listShortcuts();
  if (opts.shortcutId) return items.find((s) => s.id === opts.shortcutId);
  if (opts.command) {
    const c = opts.command.replace(/^\//, '').toLowerCase();
    return items.find((s) => s.command === c);
  }
  return undefined;
}
