import { sanitizeErrorMessage } from './probe.ts';
import { normalizeBaseUrl, safeFetch } from './ssrf.ts';

export interface NormalizedPricingModel {
  modelName: string;
  vendorId: number | string | null;
  ownerBy: string;
  quotaType: 0 | 1;
  modelRatio: number;
  completionRatio: number;
  modelPrice: number;
  enableGroups: string[];
  description: string;
  supportedEndpointTypes: string[];
  billingMode?: string;
  billingExpr?: string;
  hasPricing?: boolean;
}

export interface NormalizedPricingResponse {
  baseUrl: string;
  source?: 'pricing' | 'v1-models';
  fetchedAt: number;
  models: NormalizedPricingModel[];
  groupRatio: Record<string, number>;
  usableGroup: Record<string, string>;
  vendors: Record<string, string>;
}

function toFiniteNumber(value: unknown, fallback = 0): number {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function normalizeVendors(rawVendors: unknown): Record<string, string> {
  const map: Record<string, string> = {};
  if (Array.isArray(rawVendors)) {
    for (const item of rawVendors) {
      if (item && typeof item === 'object') {
        const rec = item as Record<string, unknown>;
        const id = rec.id ?? rec.vendor_id;
        const name = rec.name ?? rec.vendor_name;
        if (id !== undefined && id !== null && typeof name === 'string' && name.trim()) {
          map[String(id)] = name.trim();
        }
      }
    }
  } else if (rawVendors && typeof rawVendors === 'object') {
    for (const [k, v] of Object.entries(rawVendors as Record<string, unknown>)) {
      if (typeof v === 'string' && v.trim()) {
        map[k] = v.trim();
      } else if (v && typeof v === 'object' && typeof (v as Record<string, unknown>).name === 'string') {
        map[k] = String((v as Record<string, unknown>).name).trim();
      }
    }
  }
  return map;
}

export function normalizePricingPayload(baseUrl: string, payload: unknown, now = Date.now()): NormalizedPricingResponse {
  if (!payload || typeof payload !== 'object') {
    throw new Error('上游 /api/pricing 返回格式无效');
  }

  const raw = payload as Record<string, unknown>;
  const dataList = Array.isArray(raw.data) ? raw.data : [];

  const groupRatio: Record<string, number> = {};
  if (raw.group_ratio && typeof raw.group_ratio === 'object') {
    for (const [group, ratio] of Object.entries(raw.group_ratio as Record<string, unknown>)) {
      const n = toFiniteNumber(ratio, NaN);
      if (Number.isFinite(n)) {
        groupRatio[group] = n;
      }
    }
  }

  const usableGroup: Record<string, string> = {};
  if (raw.usable_group && typeof raw.usable_group === 'object') {
    for (const [group, label] of Object.entries(raw.usable_group as Record<string, unknown>)) {
      usableGroup[group] = typeof label === 'string' ? label : String(label ?? '');
    }
  }

  const vendors = normalizeVendors(raw.vendors);

  const models: NormalizedPricingModel[] = [];
  for (const item of dataList) {
    if (!item || typeof item !== 'object') continue;
    const rec = item as Record<string, unknown>;
    const modelName = typeof rec.model_name === 'string' ? rec.model_name.trim() : '';
    if (!modelName) continue;

    const quotaType = toFiniteNumber(rec.quota_type, 0) === 1 ? 1 : 0;
    const enableGroups = Array.isArray(rec.enable_groups)
      ? rec.enable_groups.map((g) => String(g)).filter(Boolean)
      : [];

    const supportedEndpointTypes = Array.isArray(rec.supported_endpoint_types)
      ? rec.supported_endpoint_types.map((e) => String(e)).filter(Boolean)
      : [];

    const vendorId =
      typeof rec.vendor_id === 'number' || typeof rec.vendor_id === 'string' ? rec.vendor_id : null;

    models.push({
      modelName,
      vendorId,
      ownerBy: typeof rec.owner_by === 'string' ? rec.owner_by : '',
      quotaType,
      modelRatio: toFiniteNumber(rec.model_ratio, 0),
      completionRatio: toFiniteNumber(rec.completion_ratio, 1),
      modelPrice: toFiniteNumber(rec.model_price, 0),
      enableGroups,
      description: typeof rec.description === 'string' ? rec.description : '',
      supportedEndpointTypes,
      billingMode: typeof rec.billing_mode === 'string' ? rec.billing_mode : undefined,
      billingExpr: typeof rec.billing_expr === 'string' ? rec.billing_expr : undefined,
      hasPricing: true,
    });
  }

  return {
    baseUrl,
    source: 'pricing',
    fetchedAt: now,
    models,
    groupRatio,
    usableGroup,
    vendors,
  };
}

const GENERIC_OWNERS = new Set(['', 'system', 'default', 'unknown', 'null', 'one-api', 'new-api', 'openai-internal', 'custom']);

function inferOwnerFromModelName(modelName: string, rawOwner: string): string {
  const cleanedOwner = rawOwner.trim();
  if (cleanedOwner && !GENERIC_OWNERS.has(cleanedOwner.toLowerCase())) {
    return cleanedOwner;
  }
  const core = modelName
    .replace(/^(\[[^\]]*\]|【[^】]*】|\([^)]*\)|（[^）]*）|\s)+/g, '')
    .toLowerCase();
  if (/claude/.test(core)) return 'Anthropic';
  if (/gemini|gemma|imagen|veo/.test(core)) return 'Google';
  if (/^(gpt|o1|o3|o4|chatgpt|dall-e|whisper|tts|text-embedding)/.test(core)) return 'OpenAI';
  if (/deepseek/.test(core)) return 'DeepSeek';
  if (/qwen|qwq/.test(core)) return 'Qwen';
  if (/grok/.test(core)) return 'xAI';
  if (/glm|chatglm|cogview/.test(core)) return 'Zhipu';
  if (/llama/.test(core)) return 'Meta';
  if (/mistral|mixtral|codestral/.test(core)) return 'Mistral';
  return cleanedOwner;
}

export function buildV1ModelsUrl(rawBaseUrl: string): string {
  const baseUrl = normalizeBaseUrl(rawBaseUrl);
  return baseUrl.endsWith('/v1') ? `${baseUrl}/models` : `${baseUrl}/v1/models`;
}

export function normalizeV1ModelsPayload(
  baseUrl: string,
  payload: unknown,
  now = Date.now(),
): NormalizedPricingResponse {
  let rawList: unknown[] = [];
  if (Array.isArray(payload)) {
    rawList = payload;
  } else if (payload && typeof payload === 'object') {
    const obj = payload as Record<string, unknown>;
    if (Array.isArray(obj.data)) rawList = obj.data;
    else if (Array.isArray(obj.models)) rawList = obj.models;
    else {
      throw new Error('上游 /v1/models 返回格式无效');
    }
  } else {
    throw new Error('上游 /v1/models 返回格式无效');
  }

  const seen = new Set<string>();
  const models: NormalizedPricingModel[] = [];

  for (const item of rawList) {
    let modelName = '';
    let rawOwner = '';
    if (typeof item === 'string') {
      modelName = item.trim();
    } else if (item && typeof item === 'object') {
      const rec = item as Record<string, unknown>;
      const rawId = rec.id ?? rec.model_name ?? rec.model ?? rec.name;
      modelName = typeof rawId === 'string' ? rawId.trim() : '';
      rawOwner = typeof rec.owned_by === 'string' ? rec.owned_by : typeof rec.owner_by === 'string' ? rec.owner_by : '';
    }
    if (!modelName || seen.has(modelName)) continue;
    seen.add(modelName);

    models.push({
      modelName,
      vendorId: null,
      ownerBy: inferOwnerFromModelName(modelName, rawOwner),
      quotaType: 0,
      modelRatio: 0,
      completionRatio: 1,
      modelPrice: 0,
      enableGroups: [],
      description: '',
      supportedEndpointTypes: [],
      hasPricing: false,
    });
  }

  return {
    baseUrl,
    source: 'v1-models',
    fetchedAt: now,
    models,
    groupRatio: {},
    usableGroup: {},
    vendors: {},
  };
}

export async function fetchV1Models(
  rawBaseUrl: string,
  rawApiKey: string,
  fetchFn: typeof fetch = fetch,
): Promise<NormalizedPricingResponse> {
  const apiKey = String(rawApiKey || '').trim();
  if (!apiKey) {
    throw new Error('缺少 API 密钥，无法请求 /v1/models');
  }
  const baseUrl = normalizeBaseUrl(rawBaseUrl);
  const endpoint = buildV1ModelsUrl(baseUrl);

  const response = await safeFetch(
    endpoint,
    {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${apiKey}`,
        'User-Agent': 'Weathercock/1.0',
      },
    },
    15000,
    fetchFn,
  );

  if (!response.ok) {
    let detail = '';
    try {
      const text = await response.text();
      if (text) {
        try {
          const parsed = JSON.parse(text) as Record<string, unknown>;
          const errObj = parsed.error && typeof parsed.error === 'object' ? (parsed.error as Record<string, unknown>) : null;
          detail = String(errObj?.message || parsed.message || text);
        } catch {
          detail = text;
        }
      }
    } catch {
      detail = '';
    }
    const cleanDetail = sanitizeErrorMessage(detail, apiKey);
    throw new Error(
      cleanDetail
        ? `上游 /v1/models 请求失败（HTTP ${response.status}）：${cleanDetail}`
        : `上游 /v1/models 请求失败（HTTP ${response.status}）`,
    );
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new Error('上游 /v1/models 返回了非 JSON 内容');
  }

  return normalizeV1ModelsPayload(baseUrl, payload);
}

export async function fetchPricing(
  rawBaseUrl: string,
  fetchFn: typeof fetch = fetch,
): Promise<NormalizedPricingResponse> {
  const baseUrl = normalizeBaseUrl(rawBaseUrl);
  const endpoint = `${baseUrl}/api/pricing`;

  const response = await safeFetch(
    endpoint,
    {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'User-Agent': 'Weathercock/1.0',
      },
    },
    15000,
    fetchFn,
  );

  if (!response.ok) {
    throw new Error(`上游 /api/pricing 请求失败（HTTP ${response.status}）`);
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new Error('上游 /api/pricing 返回了非 JSON 内容');
  }

  return normalizePricingPayload(baseUrl, payload);
}
