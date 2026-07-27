/**
 * Anthropic API 客户端（走用户自己的 API 中转站）。
 *
 * Base URL = 中转**根地址**，**不要**再拼 `/v1`。
 * `@anthropic-ai/sdk` 的请求路径已经是 `/v1/messages`、`/v1/models`：
 *   baseURL `http://host:8317`  →  `http://host:8317/v1/messages`
 * 若再把 baseURL 设成 `…/v1`，会变成 `…/v1/v1/messages`（双 /v1）。
 *
 * `dangerouslyAllowBrowser` 是必须的 —— SDK 默认拒绝在浏览器里跑，
 * 因为怕 API Key 泄露给网页。但这里是扩展的**特权页面**（侧栏），
 * 不是网页：网页脚本读不到扩展的 chrome.storage，也进不了这个 JS 上下文。
 */

import Anthropic from '@anthropic-ai/sdk';
import type { MessageParam } from '@anthropic-ai/sdk/resources/messages';
import type { MessageStream } from '@anthropic-ai/sdk/lib/MessageStream';
import { loadSettings, normalizeBaseUrl, peekSettings } from '@/storage/settings';
import type { AnthropicToolSchema } from '@/tools/schemas';

export class ApiConfigError extends Error {}

/**
 * 建客户端。
 *
 * 每次调用都新建而不是缓存单例：用户可能刚在配置页改了 base/key，
 * 缓存的客户端会继续用旧值，表现成"改了没生效"，非常难查。
 */
export function createClient(): Anthropic {
  const s = peekSettings();

  if (!s.apiKey?.trim()) {
    throw new ApiConfigError(
      'No API key configured. Open the extension options and enter your API key.',
    );
  }
  if (!s.apiBaseUrl?.trim()) {
    throw new ApiConfigError(
      'No API base URL configured. Open the extension options and enter your relay base URL.',
    );
  }

  return new Anthropic({
    apiKey: s.apiKey.trim(),
    // Root only — SDK paths already include /v1/…
    baseURL: normalizeBaseUrl(s.apiBaseUrl),
    dangerouslyAllowBrowser: true,
    maxRetries: 2,
    // 工具调用轮次多，单轮也可能很长；超时给宽一点但不无限
    timeout: 120_000,
  });
}

export interface StreamOptions {
  system: string;
  messages: MessageParam[];
  tools: AnthropicToolSchema[];
  signal: AbortSignal;
  model?: string;
  maxTokens?: number;
}

/**
 * 开一个流式请求。
 *
 * 返回 SDK 的 MessageStream，由 agent loop 消费事件。
 * 这里不做 loop 逻辑 —— 客户端只负责"把请求发出去"。
 */
export function streamMessage(opts: StreamOptions): MessageStream {
  const client = createClient();
  const s = peekSettings();

  return client.messages.stream(
    {
      model: opts.model ?? s.model,
      max_tokens: opts.maxTokens ?? s.maxTokens,
      system: [
        {
          type: 'text',
          text: opts.system,
          // 系统提示每轮都一样且很长，缓存它能显著降低成本和首字延迟
          cache_control: { type: 'ephemeral' },
        },
      ],
      messages: opts.messages,
      tools: opts.tools.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.input_schema as never,
      })),
    },
    { signal: opts.signal },
  );
}

export interface CreateMessageOptions {
  system: string;
  messages: MessageParam[];
  model?: string;
  maxTokens?: number;
  signal?: AbortSignal;
}

/**
 * Non-streaming messages.create — used by Teach Claude step enhance / summary.
 * Prefer over streamMessage when we just need a short completion.
 */
export async function createMessage(opts: CreateMessageOptions): Promise<string> {
  const client = createClient();
  const s = peekSettings();
  const model = opts.model ?? s.model;
  if (!model?.trim()) {
    throw new ApiConfigError('No model selected. Pick a model in the extension options.');
  }

  const res = await client.messages.create(
    {
      model,
      max_tokens: opts.maxTokens ?? 256,
      system: opts.system,
      messages: opts.messages,
    },
    opts.signal ? { signal: opts.signal } : undefined,
  );

  return res.content
    .map((b) => (b.type === 'text' ? b.text : ''))
    .filter(Boolean)
    .join('\n');
}

/**
 * 拉可用模型列表。
 *
 * 中转站不一定实现 `/v1/models`。失败时**不要当成致命错误** ——
 * 用户可以在配置页手填模型名，列表只是便利功能。
 */
export async function fetchModels(): Promise<
  { ok: true; models: string[] } | { ok: false; error: string }
> {
  const s = await loadSettings();
  if (!s.apiKey?.trim() || !s.apiBaseUrl?.trim()) {
    return { ok: false, error: 'API base URL and key are required.' };
  }

  const url = `${normalizeBaseUrl(s.apiBaseUrl)}/v1/models?limit=100`;

  try {
    const res = await fetch(url, {
      headers: {
        'x-api-key': s.apiKey.trim(),
        'anthropic-version': '2023-06-01',
      },
    });

    if (!res.ok) {
      return {
        ok: false,
        error: `${res.status} ${res.statusText} from ${url}. Your relay may not implement /v1/models — you can type a model name manually.`,
      };
    }

    const body = (await res.json()) as { data?: Array<{ id?: string }> };
    const models = (body.data ?? [])
      .map((m) => m.id)
      .filter((id): id is string => typeof id === 'string' && id.length > 0);

    if (models.length === 0) {
      return { ok: false, error: 'The relay returned an empty model list.' };
    }
    return { ok: true, models };
  } catch (e) {
    return {
      ok: false,
      error: `Could not reach ${url}: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
}

/**
 * 连通性自检。配置页的"测试连接"按钮用。
 *
 * 有意发一个**最小的真实请求**（1 token）而不是只打 /v1/models：
 * 很多中转站 models 能通但 messages 要另外开权限，只测 models 会给出假的"正常"。
 */
export async function testConnection(): Promise<
  { ok: true; model: string } | { ok: false; error: string }
> {
  try {
    const client = createClient();
    const s = peekSettings();
    if (!s.model?.trim()) {
      return { ok: false, error: 'No model selected. Pick or type a model name first.' };
    }

    await client.messages.create({
      model: s.model,
      max_tokens: 1,
      messages: [{ role: 'user', content: 'hi' }],
    });

    return { ok: true, model: s.model };
  } catch (e) {
    return { ok: false, error: describeApiError(e) };
  }
}

/**
 * 把 SDK / 网络错误翻译成用户能行动的中文-友好英文提示。
 *
 * 这个函数存在的理由：中转站的报错五花八门，原始信息经常是
 * "400 {"error":{"type":"invalid_request_error"...}}"，用户看不懂该改什么。
 */
export function describeApiError(e: unknown): string {
  if (e instanceof ApiConfigError) return e.message;

  const anyErr = e as { status?: number; message?: string; error?: unknown };
  const status = anyErr?.status;
  const raw = anyErr?.message ?? String(e);

  if (status === 401 || /invalid.*api.*key|authentication/i.test(raw)) {
    return 'Authentication failed (401). Check the API key in the extension options.';
  }
  if (status === 403) {
    return 'Forbidden (403). The key may not have access to this model, or the relay blocked the request.';
  }
  if (status === 404) {
    return (
      'Not found (404). Check the base URL — use the relay root without /v1 ' +
      '(requests go to {base}/v1/messages), and the model name must exist on that relay.'
    );
  }
  if (status === 429) {
    return 'Rate limited (429). Wait a moment and try again.';
  }
  if (status === 400 && /max_tokens/i.test(raw)) {
    return 'The request exceeded the model max_tokens. Lower "Max tokens" in the options.';
  }
  if (status === 400 && /credit|balance|quota/i.test(raw)) {
    return 'The relay reported an out-of-credit / quota error.';
  }
  if (status && status >= 500) {
    return `The relay returned ${status}. This is a server-side problem — retry, or check the relay status.`;
  }
  if (/Failed to fetch|NetworkError|ENOTFOUND|ECONNREFUSED|ECONNRESET|ETIMEDOUT|network timeout/i.test(raw)) {
    return (
      'Could not reach the relay (network / CORS / firewall, or the host is down). ' +
      'Check Base URL, that the port is open from this machine, and that the relay allows browser Origin. ' +
      'HTTP (non-TLS) relays are allowed by this extension; if it still fails, the problem is reachability, not CSP.'
    );
  }
  if (/aborted|AbortError/i.test(raw)) {
    return 'Stopped.';
  }
  return raw;
}
