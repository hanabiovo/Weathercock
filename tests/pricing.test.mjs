import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildV1ModelsUrl,
  fetchPricing,
  fetchV1Models,
  normalizePricingPayload,
  normalizeV1ModelsPayload,
} from '../src/pricing.ts';

test('normalizes New API pricing payload with ratio, per-call, groups, and vendors', () => {
  const payload = {
    data: [
      {
        model_name: 'claude-sonnet-4-6',
        vendor_id: 2,
        owner_by: 'anthropic',
        quota_type: 0,
        model_ratio: 1.5,
        completion_ratio: 5,
        model_price: 0,
        enable_groups: ['default', 'vip'],
        description: 'Claude Sonnet',
      },
      {
        model_name: 'mj-imagine',
        vendor_id: 9,
        owner_by: 'midjourney',
        quota_type: 1,
        model_ratio: 0,
        completion_ratio: 1,
        model_price: 0.08,
        enable_groups: ['default'],
      },
    ],
    group_ratio: {
      default: 1,
      vip: 0.8,
    },
    usable_group: {
      default: '默认分组',
      vip: 'VIP 分组',
    },
    vendors: [
      { id: 2, name: 'Anthropic' },
      { id: 9, name: 'Midjourney' },
    ],
  };

  const result = normalizePricingPayload('https://api.jiuzhan.top', payload, 1700000000000);
  assert.equal(result.baseUrl, 'https://api.jiuzhan.top');
  assert.equal(result.fetchedAt, 1700000000000);
  assert.equal(result.models.length, 2);
  assert.deepEqual(result.groupRatio, { default: 1, vip: 0.8 });
  assert.deepEqual(result.usableGroup, { default: '默认分组', vip: 'VIP 分组' });
  assert.deepEqual(result.vendors, { '2': 'Anthropic', '9': 'Midjourney' });

  assert.equal(result.models[0].modelName, 'claude-sonnet-4-6');
  assert.equal(result.models[0].quotaType, 0);
  assert.equal(result.models[0].modelRatio, 1.5);
  assert.equal(result.models[0].completionRatio, 5);
  assert.equal(result.models[1].quotaType, 1);
  assert.equal(result.models[1].modelPrice, 0.08);
});

test('fetchPricing hits <baseUrl>/api/pricing and throws on non-200', async () => {
  let requestedUrl = '';
  const okFetch = async (url) => {
    requestedUrl = String(url);
    return new Response(JSON.stringify({ data: [], group_ratio: { default: 1 } }), { status: 200 });
  };

  const res = await fetchPricing('https://ckffai.com/', okFetch);
  assert.equal(requestedUrl, 'https://ckffai.com/api/pricing');
  assert.equal(res.models.length, 0);

  const failFetch = async () => new Response('error', { status: 503 });
  await assert.rejects(() => fetchPricing('https://ckffai.com', failFetch), /HTTP 503/);
});

test('buildV1ModelsUrl avoids duplicate /v1 and normalizeV1ModelsPayload infers vendor without pricing', () => {
  assert.equal(buildV1ModelsUrl('https://api.shuixian.love'), 'https://api.shuixian.love/v1/models');
  assert.equal(buildV1ModelsUrl('https://api.shuixian.love/v1/'), 'https://api.shuixian.love/v1/models');

  const res = normalizeV1ModelsPayload('https://api.shuixian.love', {
    object: 'list',
    data: [
      { id: '[Ultra] claude-opus-4-5', owned_by: 'custom' },
      { id: 'gemini-2.5-pro', owned_by: 'google' },
      { id: 'gemini-2.5-pro', owned_by: 'google' },
    ],
  });

  assert.equal(res.source, 'v1-models');
  assert.equal(res.models.length, 2);
  assert.equal(res.models[0].ownerBy, 'Anthropic');
  assert.equal(res.models[0].hasPricing, false);
  assert.equal(res.models[1].ownerBy, 'google');
});

test('fetchV1Models sends bearer token and redacts apiKey in error messages', async () => {
  let seenAuth = '';
  const okFetch = async (_url, init) => {
    seenAuth = init.headers.Authorization;
    return new Response(JSON.stringify({ data: [{ id: 'gpt-4o', owned_by: 'openai' }] }), { status: 200 });
  };

  const res = await fetchV1Models('https://api.shuixian.love', 'sk-secret-123456', okFetch);
  assert.equal(seenAuth, 'Bearer sk-secret-123456');
  assert.equal(res.models[0].modelName, 'gpt-4o');

  const failFetch = async () =>
    new Response(JSON.stringify({ error: { message: 'Invalid token sk-secret-123456' } }), { status: 401 });
  await assert.rejects(
    () => fetchV1Models('https://api.shuixian.love', 'sk-secret-123456', failFetch),
    (err) => {
      assert.match(err.message, /HTTP 401/);
      assert.equal(err.message.includes('sk-secret-123456'), false);
      return true;
    },
  );
});
