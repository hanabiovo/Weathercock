import { normalizeBaseUrl, safeFetch } from './ssrf.ts';

const VISION_PROBE_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAIAAAD8GO2jAAAAJ0lEQVR42u3NMQkAAAwDsPo33anoMQjkT9pMRSAQCAQCgUAgEHwJDl0q+Gok8jNhAAAAAElFTkSuQmCC';

export interface ProbeRequest {
  baseUrl: string;
  apiKey: string;
  model: string;
  testTools?: boolean;
  testVision?: boolean;
}

export interface ProbeUsage {
  promptTokens: number | null;
  completionTokens: number | null;
  totalTokens: number | null;
  cacheReadTokens: number | null;
  reasoningTokens: number | null;
}

export interface ProbeResult {
  ok: boolean;
  httpStatus: number;
  latencyMs: number;
  supportsTools: boolean | null;
  supportsVision: boolean | null;
  usage: ProbeUsage | null;
  error: string | null;
}

function toNullableNumber(val: unknown): number | null {
  if (val === null || val === undefined) return null;
  const n = Number(val);
  return Number.isFinite(n) ? n : null;
}

export function sanitizeErrorMessage(raw: string, apiKey?: string): string {
  let text = raw.replace(/\s+/g, ' ').trim();
  if (apiKey && apiKey.length >= 6) {
    text = text.split(apiKey).join('[REDACTED]');
  }
  text = text
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [REDACTED]')
    .replace(/sk-[A-Za-z0-9_-]{8,}/g, 'sk-[REDACTED]');

  if (text.length > 240) {
    text = `${text.slice(0, 240)}...`;
  }
  return text;
}

export function buildChatCompletionsUrl(rawBaseUrl: string): string {
  const base = normalizeBaseUrl(rawBaseUrl);
  if (base.endsWith('/v1')) {
    return `${base}/chat/completions`;
  }
  return `${base}/v1/chat/completions`;
}

export function parseProbeUsage(payload: Record<string, unknown>): ProbeUsage | null {
  const rawUsage = payload.usage;
  if (!rawUsage || typeof rawUsage !== 'object') return null;

  const u = rawUsage as Record<string, unknown>;
  const promptDetails = (
    u.prompt_tokens_details && typeof u.prompt_tokens_details === 'object'
      ? u.prompt_tokens_details
      : {}
  ) as Record<string, unknown>;
  const completionDetails = (
    u.completion_tokens_details && typeof u.completion_tokens_details === 'object'
      ? u.completion_tokens_details
      : {}
  ) as Record<string, unknown>;

  const promptTokens = toNullableNumber(u.prompt_tokens ?? u.input_tokens);
  const completionTokens = toNullableNumber(u.completion_tokens ?? u.output_tokens);
  const totalTokens = toNullableNumber(u.total_tokens);
  const cacheReadTokens = toNullableNumber(
    promptDetails.cached_tokens ?? u.cache_read_input_tokens ?? u.prompt_cache_hit_tokens,
  );
  const reasoningTokens = toNullableNumber(completionDetails.reasoning_tokens);

  if (
    promptTokens === null &&
    completionTokens === null &&
    totalTokens === null &&
    cacheReadTokens === null &&
    reasoningTokens === null
  ) {
    return null;
  }

  return {
    promptTokens,
    completionTokens,
    totalTokens,
    cacheReadTokens,
    reasoningTokens,
  };
}

function detectToolCall(payload: Record<string, unknown>): boolean {
  const choices = Array.isArray(payload.choices) ? payload.choices : [];
  const first = choices[0];
  if (!first || typeof first !== 'object') return false;
  const msg = (first as Record<string, unknown>).message;
  if (!msg || typeof msg !== 'object') return false;
  const msgRec = msg as Record<string, unknown>;

  if (Array.isArray(msgRec.tool_calls) && msgRec.tool_calls.length > 0) {
    return true;
  }
  if (msgRec.function_call && typeof msgRec.function_call === 'object') {
    return true;
  }
  return false;
}

function extractMessageText(payload: Record<string, unknown>): string {
  const choices = Array.isArray(payload.choices) ? payload.choices : [];
  const first = choices[0];
  if (!first || typeof first !== 'object') return '';
  const msg = (first as Record<string, unknown>).message;
  if (!msg || typeof msg !== 'object') return '';
  const content = (msg as Record<string, unknown>).content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => (part && typeof part === 'object' && typeof (part as Record<string, unknown>).text === 'string'
        ? String((part as Record<string, unknown>).text)
        : ''))
      .join(' ');
  }
  return '';
}

function detectVisionSupport(payload: Record<string, unknown>): boolean {
  const text = extractMessageText(payload).trim().toLowerCase();
  if (!text) return false;
  if (/\b(none|cannot|unable)\b|看不到|无法识别|没有图片/.test(text)) {
    return false;
  }
  return /\b(yellow|gold|amber)\b|黄/.test(text);
}

export async function runProbe(
  input: ProbeRequest,
  fetchFn: typeof fetch = fetch,
  nowFn: () => number = () => Date.now(),
): Promise<ProbeResult> {
  if (!input || typeof input !== 'object') {
    throw new Error('请求体无效');
  }
  const apiKey = typeof input.apiKey === 'string' ? input.apiKey.trim() : '';
  const model = typeof input.model === 'string' ? input.model.trim() : '';
  const testTools = Boolean(input.testTools);
  const testVision = Boolean(input.testVision);

  if (!apiKey) {
    throw new Error('请先在站点设置中填写 API Key');
  }
  if (!model) {
    throw new Error('缺少待测试的模型名称');
  }

  const endpoint = buildChatCompletionsUrl(input.baseUrl);

  const body: Record<string, unknown> = testVision
    ? {
        model,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: 'What color is this image? Reply with one English word only (e.g. red, yellow, blue, purple). If you cannot see any image, reply NONE.',
              },
              {
                type: 'image_url',
                image_url: {
                  url: VISION_PROBE_DATA_URL,
                  detail: 'low',
                },
              },
            ],
          },
        ],
        max_tokens: 24,
        temperature: 0,
        stream: false,
      }
    : testTools
      ? {
          model,
          messages: [
            {
              role: 'user',
              content: 'Call the ping tool once with message "ok". Do not reply without calling the tool.',
            },
          ],
          tools: [
            {
              type: 'function',
              function: {
                name: 'ping',
                description: 'Connectivity probe tool',
                parameters: {
                  type: 'object',
                  properties: {
                    message: { type: 'string' },
                  },
                  required: ['message'],
                },
              },
            },
          ],
          tool_choice: 'auto',
          max_tokens: 64,
          temperature: 0,
          stream: false,
        }
      : {
          model,
          messages: [{ role: 'user', content: 'Reply OK.' }],
          max_tokens: 16,
          temperature: 0,
          stream: false,
        };

  const startedAt = nowFn();
  let response: Response;
  try {
    response = await safeFetch(
      endpoint,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          Authorization: `Bearer ${apiKey}`,
          'User-Agent': 'Weathercock/1.0',
        },
        body: JSON.stringify(body),
      },
      25000,
      fetchFn,
    );
  } catch (err) {
    const latencyMs = Math.max(0, Math.round(nowFn() - startedAt));
    const message = err instanceof Error ? err.message : '网络请求失败';
    return {
      ok: false,
      httpStatus: 0,
      latencyMs,
      supportsTools: testTools ? false : null,
      supportsVision: testVision ? false : null,
      usage: null,
      error: sanitizeErrorMessage(message, apiKey),
    };
  }

  const latencyMs = Math.max(0, Math.round(nowFn() - startedAt));
  const rawText = await response.text();

  if (!response.ok) {
    let detail = rawText;
    try {
      const parsedErr = JSON.parse(rawText) as Record<string, unknown>;
      const errObj = parsedErr.error;
      if (typeof errObj === 'string') {
        detail = errObj;
      } else if (errObj && typeof errObj === 'object' && typeof (errObj as Record<string, unknown>).message === 'string') {
        detail = String((errObj as Record<string, unknown>).message);
      } else if (typeof parsedErr.message === 'string') {
        detail = parsedErr.message;
      }
    } catch {
      // keep rawText
    }
    return {
      ok: false,
      httpStatus: response.status,
      latencyMs,
      supportsTools: testTools ? false : null,
      supportsVision: testVision ? false : null,
      usage: null,
      error: sanitizeErrorMessage(detail || `HTTP ${response.status}`, apiKey),
    };
  }

  let payload: Record<string, unknown>;
  try {
    const parsed = JSON.parse(rawText);
    if (!parsed || typeof parsed !== 'object') {
      throw new Error('非对象响应');
    }
    payload = parsed as Record<string, unknown>;
  } catch {
    return {
      ok: false,
      httpStatus: response.status,
      latencyMs,
      supportsTools: testTools ? false : null,
      supportsVision: testVision ? false : null,
      usage: null,
      error: '上游返回了无法解析的非 JSON 内容',
    };
  }

  const usage = parseProbeUsage(payload);
  const supportsTools = testTools ? detectToolCall(payload) : null;
  const supportsVision = testVision ? detectVisionSupport(payload) : null;

  return {
    ok: true,
    httpStatus: response.status,
    latencyMs,
    supportsTools,
    supportsVision,
    usage,
    error: null,
  };
}
