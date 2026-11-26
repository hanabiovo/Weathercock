import test from 'node:test';
import assert from 'node:assert/strict';
import { assertSafePublicUrl, normalizeBaseUrl, safeFetch, SsrfError } from '../src/ssrf.ts';

test('allows valid public https URLs and normalizes trailing slash', () => {
  const url = assertSafePublicUrl('https://api.jiuzhan.top/api/pricing');
  assert.equal(url.hostname, 'api.jiuzhan.top');
  assert.equal(normalizeBaseUrl('https://api.jiuzhan.top///'), 'https://api.jiuzhan.top');
  assert.equal(normalizeBaseUrl('https://example.com/relay/'), 'https://example.com/relay');
});

test('rejects non-https protocols and credentials', () => {
  assert.throws(() => assertSafePublicUrl('http://api.jiuzhan.top'), SsrfError);
  assert.throws(() => assertSafePublicUrl('file:///etc/passwd'), SsrfError);
  assert.throws(() => assertSafePublicUrl('https://user:pass@api.jiuzhan.top'), SsrfError);
});

test('rejects localhost, private IPv4, metadata, and private IPv6', () => {
  const blocked = [
    'https://localhost/api/pricing',
    'https://sub.localhost/api/pricing',
    'https://router.local/api',
    'https://metadata.google.internal/computeMetadata/v1/',
    'https://127.0.0.1/api',
    'https://127.0.0.2:8443/api',
    'https://10.0.0.1/api',
    'https://172.16.5.4/api',
    'https://192.168.1.1/api',
    'https://169.254.169.254/latest/meta-data/',
    'https://100.64.0.1/api',
    'https://0.0.0.0/api',
    'https://[::1]/api',
    'https://[fc00::1]/api',
    'https://[fd12:3456::1]/api',
    'https://[fe80::1]/api',
    'https://[::ffff:127.0.0.1]/api',
    'https://intranet/api',
  ];

  for (const target of blocked) {
    assert.throws(() => assertSafePublicUrl(target), SsrfError, `Expected to block ${target}`);
  }
});

test('safeFetch enforces redirect: manual and blocks 3xx redirects', async () => {
  let capturedInit;
  const okFetch = async (_url, init) => {
    capturedInit = init;
    return new Response('{}', { status: 200 });
  };

  await safeFetch('https://api.jiuzhan.top/api/pricing', { method: 'GET' }, 5000, okFetch);
  assert.equal(capturedInit.redirect, 'manual');

  const redirectFetch = async () =>
    new Response('', { status: 302, headers: { Location: 'http://127.0.0.1/admin' } });
  await assert.rejects(
    () => safeFetch('https://api.jiuzhan.top/api/pricing', { method: 'GET' }, 5000, redirectFetch),
    SsrfError,
  );
});
