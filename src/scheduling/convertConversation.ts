/**
 * Official FZ “Convert to task” path:
 * conversation → small/fast LLM → <scheduled_task> XML → Schedule.
 *
 * Prompt + tag set are ported from Claude in Chrome 1.0.81 sidepanel.
 */

import type { MessageParam } from '@anthropic-ai/sdk/resources/messages';
import { createMessage } from '@/api/client';
import { peekSettings } from '@/storage/settings';
import { createSchedule, type Schedule } from './store';

export type ConvertFrequency = 'once' | 'daily' | 'weekly' | 'monthly' | 'annually';

export interface ConvertedTask {
  title: string;
  prompt: string;
  frequency: ConvertFrequency;
  url: string;
  datetime: string;
  /**
   * Minutes for chrome.alarms delay/period.
   * `once` → delay only (no periodInMinutes); recurring → periodInMinutes.
   */
  everyMinutes: number;
}

const SYSTEM =
  'You are a helpful AI assistant tasked with converting browser automation conversations into scheduled tasks.';

const USER_INSTRUCTION = `Convert our conversation into a scheduled task that could recreate the actions we performed.

IMPORTANT: Even if the original conversation wasn't about scheduling, your job is to create a scheduled task that would REPRODUCE the same actions that were performed.

For example:
- If the user asked "What do you see?" and you took a screenshot, create a task that takes screenshots
- If the user asked to fill out a form, create a task that fills out that same form
- If the user asked to check something on a page, create a task that checks the same thing

Extract and infer from our conversation:
- A concise title describing what the task does (max 50 characters)
- A detailed prompt that would recreate the same actions (be specific about what was done)
- The most sensible frequency (once/daily/weekly/monthly/annually) - default to 'once' if unclear
- The starting URL from the conversation (or the current page URL if actions were performed)
- A reasonable time (use current time + 1 hour for 'once', or 09:00 for recurring)

CRITICAL: If the conversation involved corrections, refinements, or multiple attempts to get something right, incorporate those lessons into the task prompt so it will succeed correctly on the first try. Don't replicate the mistakes - preserve the final working approach.

The scheduled task should be written as if instructing someone to repeat exactly what was done in this conversation.

Format your response ONLY as XML with no other text or explanation:
<scheduled_task>
  <title>...</title>
  <prompt>...</prompt>
  <frequency>once|daily|weekly|monthly|annually</frequency>
  <url>...</url>
  <datetime>...</datetime>
</scheduled_task>`;

/** Official cadence → minutes for chrome.alarms delay / period. */
export function frequencyToMinutes(freq: ConvertFrequency): number {
  switch (freq) {
    case 'once':
      // One-shot delay (~1h). createSchedule({ once:true }) uses delay-only, no period.
      return 60;
    case 'daily':
      return 24 * 60;
    case 'weekly':
      return 7 * 24 * 60;
    case 'monthly':
      return 30 * 24 * 60;
    case 'annually':
      return 365 * 24 * 60;
    default:
      return 24 * 60;
  }
}

function normalizeFrequency(raw: string): ConvertFrequency {
  const f = raw.toLowerCase().trim();
  if (f === 'once' || f === 'daily' || f === 'weekly' || f === 'monthly' || f === 'annually') {
    return f;
  }
  return 'once';
}

function tag(body: string, name: string): string {
  const m = body.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`, 'i'));
  return m?.[1]?.trim() ?? '';
}

export function parseScheduledTaskXml(
  text: string,
  fallbackUrl = '',
): ConvertedTask {
  const m = text.match(/<scheduled_task>([\s\S]*?)<\/scheduled_task>/i);
  if (!m?.[1]) {
    throw new Error('Could not parse the task configuration');
  }
  const body = m[1];
  const title = tag(body, 'title') || 'Converted task';
  const prompt = tag(body, 'prompt') || 'Task converted from chat';
  const frequency = normalizeFrequency(tag(body, 'frequency') || 'once');
  const url = tag(body, 'url') || fallbackUrl || '';
  const datetime = tag(body, 'datetime');
  return {
    title: title.length > 50 ? `${title.slice(0, 47)}…` : title,
    prompt,
    frequency,
    url,
    datetime,
    everyMinutes: frequencyToMinutes(frequency),
  };
}

/** Flatten transcript items into Anthropic message params (user/assistant text only). */
export function transcriptToMessages(
  items: Array<{ kind: string; text?: string; role?: string }>,
): MessageParam[] {
  const out: MessageParam[] = [];
  for (const it of items) {
    const role =
      it.kind === 'user' || it.role === 'user'
        ? 'user'
        : it.kind === 'assistant' || it.role === 'assistant'
          ? 'assistant'
          : null;
    if (!role) continue;
    const text = (it.text ?? '').trim();
    if (!text) continue;
    out.push({ role, content: text });
  }
  if (out.length > 0 && out[0]!.role === 'assistant') {
    out.unshift({ role: 'user', content: 'Continue the conversation.' });
  }
  return out;
}

/**
 * Call the model and return a parsed ConvertedTask.
 * Prefer a small/fast model when listed in settings.availableModels.
 */
export async function convertConversationToTask(opts: {
  items: Array<{ kind: string; text?: string; role?: string }>;
  currentUrl?: string;
  signal?: AbortSignal;
}): Promise<ConvertedTask> {
  const messages = transcriptToMessages(opts.items);
  if (messages.length === 0) {
    throw new Error('No conversation to convert');
  }
  messages.push({ role: 'user', content: USER_INSTRUCTION });

  const s = peekSettings();
  const small =
    s.availableModels.find((m) =>
      /haiku|small|fast|mini|3-5-haiku|3\.5-haiku|4-5-haiku/i.test(m),
    ) ?? s.model;

  const text = await createMessage({
    system: SYSTEM,
    messages,
    model: small,
    maxTokens: 2000,
    signal: opts.signal,
  });

  return parseScheduledTaskXml(text, opts.currentUrl ?? '');
}

/** Full path: LLM convert → createSchedule → return schedule. */
export async function convertAndCreateSchedule(opts: {
  items: Array<{ kind: string; text?: string; role?: string }>;
  currentUrl?: string;
  signal?: AbortSignal;
}): Promise<{ schedule: Schedule; task: ConvertedTask }> {
  const task = await convertConversationToTask(opts);
  const schedule = await createSchedule({
    title: task.title,
    prompt: task.prompt,
    everyMinutes: task.everyMinutes,
    tabUrl: task.url || opts.currentUrl,
    // Official frequency once: single fire then auto-disable (no periodInMinutes).
    once: task.frequency === 'once',
  });
  return { schedule, task };
}
