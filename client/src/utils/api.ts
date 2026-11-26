import type { KumaData, PricingData, ProbeRecord } from '../types/weathercock';
import type { ExportPayload } from './storage';

export async function apiFetchHealth(): Promise<{ syncEnabled: boolean }> {
  const res = await fetch('/api/health');
  if (!res.ok) return { syncEnabled: false };
  const data = (await res.json()) as { syncEnabled?: boolean };
  return { syncEnabled: Boolean(data.syncEnabled) };
}

export async function apiFetchPricing(baseUrl: string, forceRefresh = false): Promise<PricingData> {
  const q = new URLSearchParams({ baseUrl });
  if (forceRefresh) q.set('refresh', '1');
  const res = await fetch(`/api/proxy/pricing?${q.toString()}`);
  const data = (await res.json()) as PricingData & { ok: boolean; error?: string };
  if (!res.ok || !data.ok) {
    throw new Error(data.error || `拉取模型广场失败（HTTP ${res.status}）`);
  }
  return data;
}

export async function apiFetchV1Models(baseUrl: string, apiKey: string): Promise<PricingData> {
  const res = await fetch('/api/proxy/models', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ baseUrl, apiKey }),
  });
  const data = (await res.json()) as PricingData & { ok: boolean; error?: string };
  if (!res.ok || !data.ok) {
    throw new Error(data.error || `拉取 /v1/models 失败（HTTP ${res.status}）`);
  }
  return data;
}

export async function apiFetchKuma(statusUrl: string, forceRefresh = false): Promise<KumaData> {
  const q = new URLSearchParams({ statusUrl });
  if (forceRefresh) q.set('refresh', '1');
  const res = await fetch(`/api/proxy/kuma?${q.toString()}`);
  const data = (await res.json()) as KumaData & { ok: boolean; error?: string };
  if (!res.ok || !data.ok) {
    throw new Error(data.error || `拉取状态页失败（HTTP ${res.status}）`);
  }
  return data;
}

export async function apiFetchNativeUptime(baseUrl: string, forceRefresh = false): Promise<KumaData> {
  const q = new URLSearchParams({ baseUrl });
  if (forceRefresh) q.set('refresh', '1');
  const res = await fetch(`/api/proxy/uptime?${q.toString()}`);
  const data = (await res.json()) as KumaData & { ok: boolean; error?: string };
  if (!res.ok || !data.ok) {
    throw new Error(data.error || `拉取站点监控失败（HTTP ${res.status}）`);
  }
  return data;
}

export async function apiProbeModel(params: {
  baseUrl: string;
  apiKey: string;
  model: string;
  testTools: boolean;
  testVision?: boolean;
}): Promise<ProbeRecord> {
  const res = await fetch('/api/probe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  const data = (await res.json()) as {
    ok?: boolean;
    httpStatus?: number;
    latencyMs?: number;
    supportsTools?: boolean | null;
    supportsVision?: boolean | null;
    usage?: ProbeRecord['usage'];
    error?: string | null;
  };
  return {
    at: Date.now(),
    ok: Boolean(data.ok),
    httpStatus: data.httpStatus ?? res.status,
    latencyMs: data.latencyMs ?? 0,
    supportsTools: data.supportsTools ?? null,
    supportsVision: data.supportsVision ?? null,
    usage: data.usage || null,
    error: data.error || null,
    testedTools: params.testTools,
    testedVision: Boolean(params.testVision),
  };
}

export async function apiCloudPull(token: string): Promise<ExportPayload | null> {
  const res = await fetch('/api/sync', {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = (await res.json()) as { ok?: boolean; error?: string; config?: ExportPayload | null };
  if (!res.ok || !data.ok) {
    throw new Error(data.error || `拉取失败（HTTP ${res.status}）`);
  }
  return data.config || null;
}

export async function apiCloudPush(token: string, payload: ExportPayload): Promise<void> {
  const res = await fetch('/api/sync', {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });
  const data = (await res.json()) as { ok?: boolean; error?: string };
  if (!res.ok || !data.ok) {
    throw new Error(data.error || `推送失败（HTTP ${res.status}）`);
  }
}
