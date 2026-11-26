import { normalizeBaseUrl, safeFetch } from './ssrf.ts';
import type { KumaMonitorSummary } from './kuma.ts';

export interface NormalizedUptimeResponse {
  baseUrl: string;
  source: 'newapi-uptime';
  fetchedAt: number;
  monitors: KumaMonitorSummary[];
}

export function normalizeNewApiUptimePayload(
  baseUrl: string,
  payload: unknown,
  now = Date.now(),
): NormalizedUptimeResponse {
  const root = (payload && typeof payload === 'object' ? payload : {}) as Record<string, unknown>;
  const categories = Array.isArray(root.data) ? root.data : [];
  const monitors: KumaMonitorSummary[] = [];

  for (const cat of categories) {
    if (!cat || typeof cat !== 'object') continue;
    const catRec = cat as Record<string, unknown>;
    const catName = typeof catRec.categoryName === 'string' ? catRec.categoryName : '';
    const list = Array.isArray(catRec.monitors) ? catRec.monitors : [];

    for (const mon of list) {
      if (!mon || typeof mon !== 'object') continue;
      const m = mon as Record<string, unknown>;
      const name = typeof m.name === 'string' ? m.name.trim() : '';
      if (!name) continue;

      const groupName = typeof m.group === 'string' && m.group.trim() ? m.group.trim() : catName;
      const rawUptime = m.uptime === null || m.uptime === undefined ? null : Number(m.uptime);
      const uptime24h = rawUptime !== null && Number.isFinite(rawUptime) ? rawUptime : null;
      const rawStatus = m.status === null || m.status === undefined ? null : Number(m.status);
      const latestStatus = rawStatus !== null && Number.isFinite(rawStatus) ? rawStatus : null;

      monitors.push({
        id: `native:${name}`,
        name,
        groupName,
        uptime24h,
        latestStatus,
        latestPing: null,
        heartbeats: [],
      });
    }
  }

  return {
    baseUrl,
    source: 'newapi-uptime',
    fetchedAt: now,
    monitors,
  };
}

export async function fetchNewApiUptime(
  rawBaseUrl: string,
  fetchFn: typeof fetch = fetch,
): Promise<NormalizedUptimeResponse> {
  const baseUrl = normalizeBaseUrl(rawBaseUrl);
  const endpoint = `${baseUrl}/api/uptime/status`;

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
    throw new Error(`上游 /api/uptime/status 请求失败（HTTP ${response.status}）`);
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new Error('上游 /api/uptime/status 返回了非 JSON 内容');
  }

  return normalizeNewApiUptimePayload(baseUrl, payload);
}
