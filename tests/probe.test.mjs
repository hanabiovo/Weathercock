import test from 'node:test';
import assert from 'node:assert/strict';
import { buildChatCompletionsUrl, runProbe, sanitizeErrorMessage } from '../src/probe.ts';

test('buildChatCompletionsUrl avoids duplicate /v1', () => {
  assert.equal(buildChatCompletionsUrl('https://api.jiuzhan.top'), 'https://api.jiuzhan.top/v1/chat/completions');
  assert.equal(buildChatCompletionsUrl('https://api.jiuzhan.top/v1/'), 'https://api.jiuzhan.top/v1/chat/completions');
});

test('sanitizeErrorMessage redacts apiKey, sk- tokens, and truncates long errors', () => {
  const key = 'sk-secret1234567890abcdef';
  const msg = `Invalid token Bearer ${key} and raw ${key} plus sk-anotherkey987654321`;
  const cleaned = sanitizeErrorMessage(msg, key);
  assert.ok(!cleaned.includes(key));
  assert.ok(!cleaned.includes('sk-anotherkey987654321'));
  assert.ok(cleaned.includes('[REDACTED]'));
});

test('runProbe detects tool call support and parses usage', async () => {
  let capturedBody;
  const mockFetch = async (_url, init) => {
    capturedBody = JSON.parse(init.body);
    return new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              role: 'assistant',
              tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'ping', arguments: '{"message":"ok"}' } }],
            },
          },
        ],
        usage: {
          prompt_tokens: 120,
          completion_tokens: 28,
          total_tokens: 148,
          prompt_tokens_details: { cached_tokens: 32 },
          completion_tokens_details: { reasoning_tokens: 10 },
        },
      }),
      { status: 200 },
    );
  };

  let tick = 1000;
  const res = await runProbe(
    {
      baseUrl: 'https://api.jiuzhan.top',
      apiKey: 'sk-test-123456789',
      model: 'claude-sonnet-4-6',
      testTools: true,
    },
    mockFetch,
    () => {
      const cur = tick;
      tick += 420;
      return cur;
    },
  );

  assert.equal(res.ok, true);
  assert.equal(res.httpStatus, 200);
  assert.equal(res.latencyMs, 420);
  assert.equal(res.supportsTools, true);
  assert.deepEqual(res.usage, {
    promptTokens: 120,
    completionTokens: 28,
    totalTokens: 148,
    cacheReadTokens: 32,
    reasoningTokens: 10,
  });
  assert.equal(Array.isArray(capturedBody.tools), true);
});

test('runProbe returns redacted error on upstream 401', async () => {
  const secretKey = 'sk-my-very-secret-key-999';
  const mockFetch = async () =>
    new Response(
      JSON.stringify({
        error: { message: `Unauthorized api key: ${secretKey}` },
      }),
      { status: 401 },
    );

  const res = await runProbe(
    {
      baseUrl: 'https://api.jiuzhan.top',
      apiKey: secretKey,
      model: 'gpt-4o',
      testTools: false,
    },
    mockFetch,
  );

  assert.equal(res.ok, false);
  assert.equal(res.httpStatus, 401);
  assert.equal(res.supportsTools, null);
  assert.equal(res.supportsVision, null);
  assert.ok(res.error && !res.error.includes(secretKey));
  assert.ok(res.error.includes('[REDACTED]'));
});

test('runProbe detects vision support and rejects silent image-stripping replies', async () => {
  let capturedBody;
  const visionFetch = async (_url, init) => {
    capturedBody = JSON.parse(init.body);
    return new Response(
      JSON.stringify({
        choices: [{ message: { role: 'assistant', content: 'Yellow' } }],
      }),
      { status: 200 },
    );
  };

  const okRes = await runProbe(
    { baseUrl: 'https://api.jiuzhan.top', apiKey: 'sk-test-123456', model: 'gpt-4o', testVision: true },
    visionFetch,
  );
  assert.equal(okRes.ok, true);
  assert.equal(okRes.supportsVision, true);
  assert.equal(Array.isArray(capturedBody.messages[0].content), true);

  const strippedFetch = async () =>
    new Response(
      JSON.stringify({
        choices: [{ message: { role: 'assistant', content: 'NONE' } }],
      }),
      { status: 200 },
    );

  const failRes = await runProbe(
    { baseUrl: 'https://api.jiuzhan.top', apiKey: 'sk-test-123456', model: 'deepseek-chat', testVision: true },
    strippedFetch,
  );
  assert.equal(failRes.ok, true);
  assert.equal(failRes.supportsVision, false);
});
