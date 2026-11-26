import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchNewApiUptime, normalizeNewApiUptimePayload } from '../src/uptime.ts';

test('normalizes New API /api/uptime/status payload', () => {
  const payload = {
    success: true,
    data: [
      {
        categoryName: 'status',
        monitors: [
          {
            name: '[反重力4][量]claude-opus-5-5[不补]',
            uptime: 0.985,
            status: 1,
            group: 'Claude',
          },
          {
            name: '[Vertex]-gemini-flash',
            uptime: 0.51,
            status: 0,
            group: 'Vertex',
          },
        ],
      },
    ],
  };

  const res = normalizeNewApiUptimePayload('https://ckffai.com', payload, 1700000000000);
  assert.equal(res.source, 'newapi-uptime');
  assert.equal(res.monitors.length, 2);
  assert.equal(res.monitors[0].name, '[反重力4][量]claude-opus-5-5[不补]');
  assert.equal(res.monitors[0].groupName, 'Claude');
  assert.equal(res.monitors[0].uptime24h, 0.985);
  assert.equal(res.monitors[0].latestStatus, 1);
  assert.equal(res.monitors[1].latestStatus, 0);
});

test('fetchNewApiUptime handles empty data list gracefully', async () => {
  const mockFetch = async () => new Response(JSON.stringify({ data: [], success: true }), { status: 200 });
  const res = await fetchNewApiUptime('https://api.jiuzhan.top', mockFetch);
  assert.equal(res.monitors.length, 0);
});
