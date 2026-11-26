export interface SyncEnv {
  MONITOR_KV?: KVNamespace;
  ACCESS_TOKEN?: string;
}

const SYNC_KV_KEY = 'weathercock:config:v1';
const MAX_SYNC_BYTES = 512 * 1024;

function timingSafeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const ab = enc.encode(a);
  const bb = enc.encode(b);
  const len = Math.max(ab.length, bb.length);
  let diff = ab.length ^ bb.length;
  for (let i = 0; i < len; i++) {
    diff |= (ab[i] ?? 0) ^ (bb[i] ?? 0);
  }
  return diff === 0;
}

export function isSyncEnabled(env: SyncEnv): boolean {
  return Boolean(env.MONITOR_KV && env.ACCESS_TOKEN && env.ACCESS_TOKEN.trim().length > 0);
}

function isAuthorized(request: Request, expectedToken: string): boolean {
  const auth = request.headers.get('Authorization') || '';
  if (!auth.startsWith('Bearer ')) return false;
  const token = auth.slice('Bearer '.length).trim();
  if (!token) return false;
  return timingSafeEqual(token, expectedToken.trim());
}

export async function handleSyncRequest(request: Request, env: SyncEnv): Promise<Response> {
  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  };

  if (!isSyncEnabled(env)) {
    return new Response(
      JSON.stringify({ ok: false, enabled: false, error: '当前部署未启用云同步（未绑定 MONITOR_KV 或 ACCESS_TOKEN）' }),
      { status: 501, headers },
    );
  }

  if (!isAuthorized(request, env.ACCESS_TOKEN!)) {
    return new Response(
      JSON.stringify({ ok: false, error: '访问令牌无效或缺失' }),
      { status: 401, headers },
    );
  }

  const kv = env.MONITOR_KV!;

  if (request.method === 'GET') {
    const raw = await kv.get(SYNC_KV_KEY);
    if (!raw) {
      return new Response(JSON.stringify({ ok: true, config: null }), { status: 200, headers });
    }
    try {
      const config = JSON.parse(raw);
      return new Response(JSON.stringify({ ok: true, config }), { status: 200, headers });
    } catch {
      return new Response(JSON.stringify({ ok: false, error: '云端存储数据损坏' }), { status: 500, headers });
    }
  }

  if (request.method === 'PUT') {
    const rawText = await request.text();
    if (new TextEncoder().encode(rawText).byteLength > MAX_SYNC_BYTES) {
      return new Response(JSON.stringify({ ok: false, error: '配置体积超过 512KB 上限' }), { status: 413, headers });
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(rawText);
    } catch {
      return new Response(JSON.stringify({ ok: false, error: '请求体必须是合法 JSON' }), { status: 400, headers });
    }

    if (!parsed || typeof parsed !== 'object' || (parsed as Record<string, unknown>).version !== 1) {
      return new Response(JSON.stringify({ ok: false, error: '配置对象缺少有效的 version: 1 字段' }), {
        status: 400,
        headers,
      });
    }

    await kv.put(SYNC_KV_KEY, JSON.stringify(parsed));
    return new Response(JSON.stringify({ ok: true, savedAt: Date.now() }), { status: 200, headers });
  }

  return new Response(JSON.stringify({ ok: false, error: 'Method Not Allowed' }), { status: 405, headers });
}
