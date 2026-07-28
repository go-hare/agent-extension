/**
 * Official generateWorkingStatus (NG in sidepanel-CEYFzMrx.js).
 *
 * StatusPill text while tools run is NOT fixed "Working" — a small/fast
 * completion turns the latest assistant (or user) text into a ≤7-word
 * goal-oriented phrase, e.g. "Gathering page content".
 *
 * We use the user's relay via createMessage. On failure, fall back to a
 * lightweight heuristic so the UI still looks official.
 */

import { createMessage } from '@/api/client';
import { hasUsableCredentials, peekSettings } from '@/storage/settings';

const SYSTEM = `Generate ultra-concise status updates describing the current high-level task or goal.
Your status should describe WHAT Claude is trying to accomplish, not the specific action.

REQUIREMENTS:
- Maximum 7 words
- Describe the goal/task, not the action
- Be high-level and task-oriented
- No punctuation at the end

Examples of GOOD statuses (goal-oriented):
- Researching company information
- Looking up flight options
- Completing checkout process
- Finding product details
- Setting up account
- Analyzing search results
- Gathering page content

Examples of BAD statuses (too action-specific):
- Clicking submit button
- Reading page content
- Taking screenshot
- Typing into form field`;

function userPrompt(message: string): string {
  return (
    `<message>\n${message}\n</message>\n\n` +
    `Based on this message, generate a 7-word-or-less status describing the high-level task or goal Claude is working on. Put it between <status> tags.`
  );
}

function parseStatus(raw: string): string {
  if (!raw) return '';
  const m = raw.match(/<status>([\s\S]*?)<\/status>/i);
  if (m?.[1]) return clean(m[1]);
  const m2 = raw.match(/^([\s\S]*?)<\/status>/i);
  if (m2?.[1]) return clean(m2[1]);
  // Model sometimes returns bare text
  const line = raw
    .split('\n')
    .map((s) => s.trim())
    .find((s) => s && !s.startsWith('<') && !/^here is/i.test(s));
  return line ? clean(line) : '';
}

function clean(s: string): string {
  return s
    .replace(/^["'“”]+|["'“”]+$/g, '')
    .replace(/[.。!！?？;；:：]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60);
}

/** Prefer haiku / small model from the available list; else current model. */
function pickFastModel(): string | undefined {
  const s = peekSettings();
  const list = s.availableModels ?? [];
  const prefer = list.find((m) => /haiku|mini|fast|small/i.test(m));
  return prefer ?? s.model;
}

/**
 * Official NG(message, createFn). Returns "" on skip/failure.
 * Caller should keep the previous hint when this returns "".
 */
export async function generateWorkingStatus(
  message: string,
  signal?: AbortSignal,
): Promise<string> {
  const text = message?.trim() ?? '';
  if (!text) return '';
  // Official skips pure <answer> blocks
  if (text.toLowerCase().includes('<answer>')) return '';
  if (!hasUsableCredentials(peekSettings())) return heuristicStatus(text);

  try {
    // Official uses assistant prefill ("Here is the status:\n\n<status>");
    // some relays reject non-user-final turns, so try prefill then bare user.
    let raw = '';
    try {
      raw = await createMessage({
        system: SYSTEM,
        messages: [
          { role: 'user', content: userPrompt(text.slice(0, 500)) },
          { role: 'assistant', content: 'Here is the status:\n\n<status>' },
        ],
        model: pickFastModel(),
        maxTokens: 64,
        signal,
      });
    } catch {
      raw = await createMessage({
        system: SYSTEM,
        messages: [{ role: 'user', content: userPrompt(text.slice(0, 500)) }],
        model: pickFastModel(),
        maxTokens: 64,
        signal,
      });
    }
    const status = parseStatus(raw.includes('<status>') ? raw : `<status>${raw}`);
    return status || heuristicStatus(text);
  } catch {
    return heuristicStatus(text);
  }
}

/**
 * Offline / error fallback — still goal-oriented, never "Clicking…".
 * Uses the user (or assistant) text when possible; else tool names.
 */
export function heuristicStatus(
  message: string,
  toolNames: string[] = [],
): string {
  const m = message.toLowerCase();
  const zh = /[\u4e00-\u9fff]/.test(message);

  if (/看看|看一下|查看|浏览|这个页面|this page|look at|check (out )?this|what('s| is) on/.test(m)) {
    return zh ? '正在查看页面内容' : 'Gathering page content';
  }
  if (/搜索|查找|find|search|look up|research/.test(m)) {
    return zh ? '正在检索信息' : 'Researching information';
  }
  if (/填|表单|登录|注册|fill|form|sign up|log ?in|checkout|下单|购买/.test(m)) {
    return zh ? '正在完成表单' : 'Completing form details';
  }
  if (/打开|访问|前往|navigate|go to|open |visit/.test(m)) {
    return zh ? '正在打开页面' : 'Opening the page';
  }
  if (/总结|摘要|summar|overview|概括/.test(m)) {
    return zh ? '正在整理摘要' : 'Summarizing the page';
  }

  if (toolNames.some((n) => n === 'read_page' || n === 'get_page_text' || n === 'find')) {
    return zh ? '正在查看页面内容' : 'Gathering page content';
  }
  if (toolNames.some((n) => n === 'update_plan')) {
    return zh ? '正在规划下一步' : 'Planning next steps';
  }
  if (toolNames.some((n) => n === 'navigate' || n === 'tabs_create')) {
    return zh ? '正在打开页面' : 'Opening the page';
  }
  if (toolNames.some((n) => n === 'form_input' || n === 'computer')) {
    return zh ? '正在与页面交互' : 'Interacting with the page';
  }

  // Last resort: shorten the message itself into a phrase-ish status
  const clipped = message.replace(/\s+/g, ' ').trim().slice(0, 40);
  if (clipped) {
    return zh ? `正在处理：${clipped}` : clipped.replace(/[.。!！?？]+$/g, '');
  }
  return '';
}

/**
 * Best text to feed NG: prefer the latest non-empty assistant text in this
 * turn (official `_`), else the latest user message.
 */
export function pickStatusSourceText(
  items: Array<{ kind: string; text?: string }>,
): string {
  let lastUser = '';
  let lastAssistant = '';
  for (const it of items) {
    if (it.kind === 'user' && typeof it.text === 'string' && it.text.trim()) {
      lastUser = it.text.trim();
      lastAssistant = '';
    } else if (
      it.kind === 'assistant' &&
      typeof it.text === 'string' &&
      it.text.trim()
    ) {
      lastAssistant = it.text.trim();
    }
  }
  // Official: assistant preamble before tools; else user goal.
  if (lastAssistant && !lastAssistant.toLowerCase().includes('<answer>')) {
    return lastAssistant;
  }
  return lastUser;
}
