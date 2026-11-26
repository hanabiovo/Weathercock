import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchKumaStatus, normalizeKumaPayload, parseKumaStatusUrl } from '../src/kuma.ts';

test('parses Uptime Kuma status page URL', () => {
  const parsed = parseKumaStatusUrl('https://status.68886868.xyz/status/api/');
  assert.deepEqual(parsed, {
    origin: 'https://status.68886868.xyz',
    slug: 'api',
    statusUrl: 'https://status.68886868.xyz/status/api',
  });

  assert.throws(() => parseKumaStatusUrl('https://status.68886868.xyz/dashboard'), /格式应为/);
});

test('normalizes Kuma metadata and heartbeat payload', () => {
  const meta = {
    config: { title: '小鸡状态页' },
    publicGroupList: [
      {
        name: 'Claude 渠道',
        monitorList: [{ id: 12, name: 'claude-sonnet-4-6' }],
      },
    ],
  };
  const hb = {
    heartbeatList: {
      '12': [
        { status: 1, ping: 412.6, time: '2026-11-24 09:00:00' },
        { status: 0, ping: null, time: '2026-11-24 09:05:00' },
        { status: 1, ping: 380, time: '2026-11-24 09:10:00' },
      ],
    },
    uptimeList: {
      '12_24': 0.986,
    },
  };

  const res = normalizeKumaPayload('https://status.68886868.xyz/status/api', meta, hb, 1700000000000);
  assert.equal(res.title, '小鸡状态页');
  assert.equal(res.monitors.length, 1);
  assert.equal(res.monitors[0].id, '12');
  assert.equal(res.monitors[0].groupName, 'Claude 渠道');
  assert.equal(res.monitors[0].uptime24h, 0.986);
  assert.equal(res.monitors[0].latestStatus, 1);
  assert.equal(res.monitors[0].latestPing, 380);
  assert.equal(res.monitors[0].heartbeats[0].ping, 413);
});

test('fetchKumaStatus fetches both meta and heartbeat endpoints concurrently', async () => {
  const seen = [];
  const mockFetch = async (url) => {
    const u = String(url);
    seen.push(u);
    if (u.includes('/heartbeat/')) {
      return new Response(JSON.stringify({ heartbeatList: {}, uptimeList: {} }), { status: 200 });
    }
    return new Response(JSON.stringify({ config: { title: 'Demo' }, publicGroupList: [] }), { status: 200 });
  };

  const result = await fetchKumaStatus('https://status.68886868.xyz/status/api', mockFetch);
  assert.equal(result.title, 'Demo');
  assert.equal(seen.length, 2);
  assert.ok(seen.includes('https://status.68886868.xyz/api/status-page/api'));
  assert.ok(seen.includes('https://status.68886868.xyz/api/status-page/heartbeat/api'));
});
