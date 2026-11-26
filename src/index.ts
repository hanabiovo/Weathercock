import { fetchKumaStatus } from './kuma.ts';
import { fetchPricing, fetchV1Models } from './pricing.ts';
import { runProbe } from './probe.ts';
import { SsrfError } from './ssrf.ts';
import { handleSyncRequest, isSyncEnabled, type SyncEnv } from './sync.ts';
import { fetchNewApiUptime } from './uptime.ts';

export interface Env extends SyncEnv {
  ASSETS: Fetcher;
}

function jsonResponse(data: unknown, status = 200, cacheSeconds = 0): Response {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': cacheSeconds > 0 ? `public, max-age=${cacheSeconds}` : 'no-store',
  };
  return new Response(JSON.stringify(data), { status, headers });
}

function mapErrorStatus(err: unknown): number {
  if (err instanceof SsrfError) return 400;
  return 502;
}

async function withEdgeCache(
  request: Request,
  ctx: ExecutionContext,
  ttlSeconds: number,
  bypass: boolean,
  producer: () => Promise<Response>,
): Promise<Response> {
  const cacheStorage = (globalThis as unknown as { caches?: CacheStorage }).caches;
  const cache = cacheStorage?.default;
  if (!cache || bypass) {
    return producer();
  }

  const cacheKey = new Request(request.url, { method: 'GET' });
  const cached = await cache.match(cacheKey);
  if (cached) {
    return cached;
  }

  const fresh = await producer();
  if (fresh.ok) {
    ctx.waitUntil(cache.put(cacheKey, fresh.clone()));
  }
  return fresh;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const { pathname } = url;

    if (pathname === '/api/health' && request.method === 'GET') {
      return jsonResponse({
        ok: true,
        name: 'weathercock',
        syncEnabled: isSyncEnabled(env),
      });
    }

    if (pathname === '/api/proxy/pricing' && request.method === 'GET') {
      const baseUrl = url.searchParams.get('baseUrl') || '';
      const bypass = url.searchParams.get('refresh') === '1';
      if (!baseUrl) {
        return jsonResponse({ ok: false, error: '缺少 baseUrl 参数' }, 400);
      }

      return withEdgeCache(request, ctx, 60, bypass, async () => {
        try {
          const data = await fetchPricing(baseUrl);
          return jsonResponse({ ok: true, ...data }, 200, 60);
        } catch (err) {
          const message = err instanceof Error ? err.message : '拉取模型广场失败';
          return jsonResponse({ ok: false, error: message }, mapErrorStatus(err));
        }
      });
    }

    if (pathname === '/api/proxy/models' && request.method === 'POST') {
      let body: Record<string, unknown>;
      try {
        body = (await request.json()) as Record<string, unknown>;
      } catch {
        return jsonResponse({ ok: false, error: '请求体必须是合法 JSON' }, 400);
      }

      const baseUrl = String(body.baseUrl ?? '');
      const apiKey = String(body.apiKey ?? '');
      if (!baseUrl || !apiKey.trim()) {
        return jsonResponse({ ok: false, error: '缺少 baseUrl 或 apiKey 参数' }, 400);
      }

      try {
        const data = await fetchV1Models(baseUrl, apiKey);
        return jsonResponse({ ok: true, ...data }, 200);
      } catch (err) {
        const message = err instanceof Error ? err.message : '拉取 /v1/models 失败';
        return jsonResponse({ ok: false, error: message }, mapErrorStatus(err));
      }
    }

    if (pathname === '/api/proxy/kuma' && request.method === 'GET') {
      const statusUrl = url.searchParams.get('statusUrl') || '';
      const bypass = url.searchParams.get('refresh') === '1';
      if (!statusUrl) {
        return jsonResponse({ ok: false, error: '缺少 statusUrl 参数' }, 400);
      }

      return withEdgeCache(request, ctx, 30, bypass, async () => {
        try {
          const data = await fetchKumaStatus(statusUrl);
          return jsonResponse({ ok: true, ...data }, 200, 30);
        } catch (err) {
          const message = err instanceof Error ? err.message : '拉取 Uptime Kuma 状态页失败';
          return jsonResponse({ ok: false, error: message }, mapErrorStatus(err));
        }
      });
    }

    if (pathname === '/api/proxy/uptime' && request.method === 'GET') {
      const baseUrl = url.searchParams.get('baseUrl') || '';
      const bypass = url.searchParams.get('refresh') === '1';
      if (!baseUrl) {
        return jsonResponse({ ok: false, error: '缺少 baseUrl 参数' }, 400);
      }

      return withEdgeCache(request, ctx, 30, bypass, async () => {
        try {
          const data = await fetchNewApiUptime(baseUrl);
          return jsonResponse({ ok: true, ...data }, 200, 30);
        } catch (err) {
          const message = err instanceof Error ? err.message : '拉取站点 /api/uptime/status 失败';
          return jsonResponse({ ok: false, error: message }, mapErrorStatus(err));
        }
      });
    }

    if (pathname === '/api/probe' && request.method === 'POST') {
      let body: Record<string, unknown>;
      try {
        body = (await request.json()) as Record<string, unknown>;
      } catch {
        return jsonResponse({ ok: false, error: '请求体必须是合法 JSON' }, 400);
      }

      try {
        const result = await runProbe({
          baseUrl: String(body.baseUrl ?? ''),
          apiKey: String(body.apiKey ?? ''),
          model: String(body.model ?? ''),
          testTools: Boolean(body.testTools),
          testVision: Boolean(body.testVision),
        });
        return jsonResponse(result, 200);
      } catch (err) {
        const message = err instanceof Error ? err.message : '探针参数校验失败';
        return jsonResponse({ ok: false, error: message }, 400);
      }
    }

    if (pathname === '/api/sync') {
      return handleSyncRequest(request, env);
    }

    if (pathname.startsWith('/api/')) {
      return jsonResponse({ ok: false, error: 'Not Found' }, 404);
    }

    return env.ASSETS.fetch(request);
  },
};
