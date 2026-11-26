export class SsrfError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SsrfError';
  }
}

const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'localhost.localdomain',
  'ip6-localhost',
  'ip6-loopback',
  'metadata.google.internal',
  'metadata',
]);

const BLOCKED_SUFFIXES = [
  '.localhost',
  '.local',
  '.internal',
  '.home.arpa',
  '.localdomain',
];

function isPrivateIpv4(ip: string): boolean {
  const parts = ip.split('.');
  if (parts.length !== 4) return false;
  const nums = parts.map((p) => Number(p));
  if (nums.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    return false;
  }
  const [a, b] = nums;

  // 0.0.0.0/8 (unspecified)
  if (a === 0) return true;
  // 10.0.0.0/8 (RFC 1918)
  if (a === 10) return true;
  // 100.64.0.0/10 (CGNAT)
  if (a === 100 && b >= 64 && b <= 127) return true;
  // 127.0.0.0/8 (loopback)
  if (a === 127) return true;
  // 169.254.0.0/16 (link-local / cloud metadata)
  if (a === 169 && b === 254) return true;
  // 172.16.0.0/12 (RFC 1918)
  if (a === 172 && b >= 16 && b <= 31) return true;
  // 192.0.0.0/24, 192.0.2.0/24, 192.168.0.0/16
  if (a === 192 && (b === 0 || b === 168)) return true;
  // 198.18.0.0/15 (benchmarking), 198.51.100.0/24 (TEST-NET-2)
  if (a === 198 && (b === 18 || b === 19 || b === 51)) return true;
  // 203.0.113.0/24 (TEST-NET-3)
  if (a === 203 && b === 0 && nums[2] === 113) return true;
  // 224.0.0.0/4 (multicast) and 240.0.0.0/4 (reserved / broadcast)
  if (a >= 224) return true;

  return false;
}

function isIpv4Literal(host: string): boolean {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(host);
}

function isPrivateOrReservedIpv6(rawHost: string): boolean {
  const host = rawHost.replace(/^\[|\]$/g, '').toLowerCase();
  if (!host.includes(':')) return false;

  // Unspecified or loopback
  if (host === '::' || host === '::1' || /^0+:0+:0+:0+:0+:0+:0+:[01]$/.test(host)) {
    return true;
  }

  // IPv4-mapped IPv6 (e.g. ::ffff:127.0.0.1 or ::ffff:7f00:1)
  if (host.startsWith('::ffff:')) {
    const tail = host.slice('::ffff:'.length);
    if (isIpv4Literal(tail)) {
      return isPrivateIpv4(tail);
    }
    const hexMatch = tail.match(/^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
    if (hexMatch) {
      const hi = parseInt(hexMatch[1], 16);
      const lo = parseInt(hexMatch[2], 16);
      const ip = `${(hi >> 8) & 255}.${hi & 255}.${(lo >> 8) & 255}.${lo & 255}`;
      return isPrivateIpv4(ip);
    }
    return true;
  }

  // Unique local fc00::/7 (fc.. / fd..)
  if (/^f[cd][0-9a-f]{2}:/.test(host)) return true;
  // Link-local fe80::/10 (fe80..febf)
  if (/^fe[89ab][0-9a-f]:/.test(host)) return true;
  // Multicast ff00::/8
  if (/^ff[0-9a-f]{2}:/.test(host)) return true;
  // Discard / documentation / deprecated site-local
  if (host.startsWith('100::') || host.startsWith('2001:db8:') || host.startsWith('fec0:')) {
    return true;
  }

  return false;
}

export function assertSafePublicUrl(rawUrl: string): URL {
  if (typeof rawUrl !== 'string' || !rawUrl.trim()) {
    throw new SsrfError('URL 不能为空');
  }

  let parsed: URL;
  try {
    parsed = new URL(rawUrl.trim());
  } catch {
    throw new SsrfError('URL 格式无效');
  }

  if (parsed.protocol !== 'https:') {
    throw new SsrfError('仅允许 https:// 公开地址');
  }

  if (parsed.username || parsed.password) {
    throw new SsrfError('不允许在 URL 中携带凭据');
  }

  const hostname = parsed.hostname.toLowerCase().replace(/\.$/, '');
  if (!hostname) {
    throw new SsrfError('URL 缺少主机名');
  }

  if (BLOCKED_HOSTNAMES.has(hostname)) {
    throw new SsrfError('禁止访问本地或内网保留主机');
  }

  if (BLOCKED_SUFFIXES.some((suffix) => hostname.endsWith(suffix))) {
    throw new SsrfError('禁止访问内网或本地域名');
  }

  // IPv6 literal
  if (hostname.startsWith('[') || hostname.includes(':')) {
    if (isPrivateOrReservedIpv6(hostname)) {
      throw new SsrfError('禁止访问内网或保留 IPv6 地址');
    }
    return parsed;
  }

  // IPv4 literal (WHATWG URL normalizes decimal/hex/octal IPv4 to dotted quad)
  if (isIpv4Literal(hostname)) {
    if (isPrivateIpv4(hostname)) {
      throw new SsrfError('禁止访问内网或保留 IPv4 地址');
    }
    return parsed;
  }

  // Reject single-label hostnames (e.g. https://intranet/)
  if (!hostname.includes('.')) {
    throw new SsrfError('不允许访问无顶级域名的主机名');
  }

  return parsed;
}

export function normalizeBaseUrl(rawUrl: string): string {
  const url = assertSafePublicUrl(rawUrl);
  const cleanPath = url.pathname.replace(/\/+$/, '');
  return `${url.origin}${cleanPath}`;
}

export async function safeFetch(
  input: string | URL,
  init: RequestInit = {},
  timeoutMs = 15000,
  fetchFn: typeof fetch = fetch,
): Promise<Response> {
  const target = typeof input === 'string' ? assertSafePublicUrl(input) : assertSafePublicUrl(input.toString());
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error('Upstream request timeout')), timeoutMs);

  try {
    const response = await fetchFn(target.toString(), {
      ...init,
      redirect: 'manual',
      signal: init.signal ?? controller.signal,
    });
    if (response.status >= 300 && response.status < 400) {
      throw new SsrfError(`已拦截上游重定向（HTTP ${response.status}）`);
    }
    return response;
  } finally {
    clearTimeout(timer);
  }
}
