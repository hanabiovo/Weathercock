import { assertSafePublicUrl, safeFetch } from './ssrf.ts';

export interface KumaHeartbeatItem {
  status: number;
  ping: number | null;
  time: string;
}

export interface KumaMonitorSummary {
  id: string;
  name: string;
  groupName: string;
  uptime24h: number | null;
  latestStatus: number | null;
  latestPing: number | null;
  heartbeats: KumaHeartbeatItem[];
}

export interface NormalizedKumaResponse {
  statusUrl: string;
  title: string;
  fetchedAt: number;
  monitors: KumaMonitorSummary[];
}

export function parseKumaStatusUrl(rawUrl: string): { origin: string; slug: string; statusUrl: string } {
  const url = assertSafePublicUrl(rawUrl);
  const match = url.pathname.match(/^\/status\/([^/]+)\/?$/);
  if (!match || !match[1]) {
    throw new Error('Uptime Kuma 状态页地址格式应为 https://<域名>/status/<slug>');
  }

  const slug = decodeURIComponent(match[1]);
  if (!/^[a-zA-Z0-9._-]+$/.test(slug)) {
    throw new Error('Uptime Kuma 状态页 slug 包含非法字符');
  }

  return {
    origin: url.origin,
    slug,
    statusUrl: `${url.origin}/status/${encodeURIComponent(slug)}`,
  };
}

export function normalizeKumaPayload(
  statusUrl: string,
  metaPayload: unknown,
  heartbeatPayload: unknown,
  now = Date.now(),
): NormalizedKumaResponse {
  const meta = (metaPayload && typeof metaPayload === 'object' ? metaPayload : {}) as Record<string, unknown>;
  const hb = (heartbeatPayload && typeof heartbeatPayload === 'object' ? heartbeatPayload : {}) as Record<
    string,
    unknown
  >;

  const configObj = (meta.config && typeof meta.config === 'object' ? meta.config : {}) as Record<string, unknown>;
  const title = typeof configObj.title === 'string' ? configObj.title : '';

  const heartbeatList = (
    hb.heartbeatList && typeof hb.heartbeatList === 'object' ? hb.heartbeatList : {}
  ) as Record<string, unknown>;

  const uptimeList = (
    hb.uptimeList && typeof hb.uptimeList === 'object' ? hb.uptimeList : {}
  ) as Record<string, unknown>;

  const publicGroupList = Array.isArray(meta.publicGroupList) ? meta.publicGroupList : [];
  const monitors: KumaMonitorSummary[] = [];

  for (const group of publicGroupList) {
    if (!group || typeof group !== 'object') continue;
    const groupRec = group as Record<string, unknown>;
    const groupName = typeof groupRec.name === 'string' ? groupRec.name : '';
    const monitorList = Array.isArray(groupRec.monitorList) ? groupRec.monitorList : [];

    for (const mon of monitorList) {
      if (!mon || typeof mon !== 'object') continue;
      const monRec = mon as Record<string, unknown>;
      if (monRec.id === undefined || monRec.id === null) continue;

      const id = String(monRec.id);
      const name = typeof monRec.name === 'string' ? monRec.name : `#${id}`;

      const rawBeats = Array.isArray(heartbeatList[id]) ? (heartbeatList[id] as unknown[]) : [];
      const heartbeats: KumaHeartbeatItem[] = rawBeats.slice(-24).map((beat) => {
        const b = (beat && typeof beat === 'object' ? beat : {}) as Record<string, unknown>;
        const status = typeof b.status === 'number' ? b.status : Number(b.status ?? 0);
        const pingNum = b.ping === null || b.ping === undefined ? null : Number(b.ping);
        return {
          status: Number.isFinite(status) ? status : 0,
          ping: pingNum !== null && Number.isFinite(pingNum) ? Math.round(pingNum) : null,
          time: typeof b.time === 'string' ? b.time : '',
        };
      });

      const rawUptime = uptimeList[`${id}_24`];
      const uptimeNum = rawUptime === undefined || rawUptime === null ? null : Number(rawUptime);
      const uptime24h = uptimeNum !== null && Number.isFinite(uptimeNum) ? uptimeNum : null;

      const latest = heartbeats.length > 0 ? heartbeats[heartbeats.length - 1] : null;

      monitors.push({
        id,
        name,
        groupName,
        uptime24h,
        latestStatus: latest ? latest.status : null,
        latestPing: latest ? latest.ping : null,
        heartbeats,
      });
    }
  }

  return {
    statusUrl,
    title,
    fetchedAt: now,
    monitors,
  };
}

export async function fetchKumaStatus(
  rawStatusUrl: string,
  fetchFn: typeof fetch = fetch,
): Promise<NormalizedKumaResponse> {
  const { origin, slug, statusUrl } = parseKumaStatusUrl(rawStatusUrl);
  const encodedSlug = encodeURIComponent(slug);
  const metaUrl = `${origin}/api/status-page/${encodedSlug}`;
  const heartbeatUrl = `${origin}/api/status-page/heartbeat/${encodedSlug}`;

  const headers = {
    Accept: 'application/json',
    'User-Agent': 'Weathercock/1.0',
  };

  const [metaRes, hbRes] = await Promise.all([
    safeFetch(metaUrl, { method: 'GET', headers }, 15000, fetchFn),
    safeFetch(heartbeatUrl, { method: 'GET', headers }, 15000, fetchFn),
  ]);

  if (!metaRes.ok) {
    throw new Error(`Kuma 元数据拉取失败（HTTP ${metaRes.status}）`);
  }
  if (!hbRes.ok) {
    throw new Error(`Kuma 心跳数据拉取失败（HTTP ${hbRes.status}）`);
  }

  let metaPayload: unknown;
  let hbPayload: unknown;
  try {
    [metaPayload, hbPayload] = await Promise.all([metaRes.json(), hbRes.json()]);
  } catch {
    throw new Error('Kuma 状态页返回了非 JSON 内容');
  }

  return normalizeKumaPayload(statusUrl, metaPayload, hbPayload);
}
