import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { handleGuidance } from './aether-api.js';

function request(body, headers = {}) {
  const stream = Readable.from([Buffer.from(body)]);
  stream.method = 'POST';
  stream.headers = { host: '127.0.0.1:4173', origin: 'http://127.0.0.1:4173', 'content-type': 'application/json', ...headers };
  return stream;
}
function response() {
  return { writeHead(status) { this.status = status; }, end(body) { this.body = JSON.parse(body); } };
}
test('guidance proxy forwards only the question and keeps the API key server-side', async t => {
  const oldKey = process.env.AETHER_API_KEY;
  process.env.AETHER_API_KEY = 'test-key';
  t.after(() => { if (oldKey == null) delete process.env.AETHER_API_KEY; else process.env.AETHER_API_KEY = oldKey; });
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(url, 'http://127.0.0.1:8000/ask');
    assert.equal(options.headers.Authorization, 'Bearer test-key');
    assert.deepEqual(JSON.parse(options.body), { question: 'sleep' });
    return { ok: true, json: async () => ({ protocol_id: 'PROTO-MIND-01', matched_protocol: 'Sleep review',
      confidence: 0.8, severity: 'CAUTION_AMBER', crew_actions: ['Review sleep opportunity.'] }) };
  });
  const res = response();
  await handleGuidance(request('{"question":"sleep","secret":"not-forwarded"}'), res);
  assert.equal(res.status, 200);
  assert.doesNotMatch(JSON.stringify(res.body), /test-key/);
});
test('guidance rejects invalid input, cross-origin callers and malformed upstream responses', async t => {
  const mock = t.mock.method(globalThis, 'fetch', async () => ({ ok: true, json: async () => ({}) }));
  for (const [body, headers, expected] of [
    ['{}', {}, 400], ['broken', {}, 400], ['{"question":"sleep"}', {origin:'https://other.example'}, 403],
    ['{"question":"sleep"}', {'content-type':'text/plain'}, 415], [JSON.stringify({question:'x'.repeat(9000)}), {}, 413]
  ]) {
    const res = response();
    await handleGuidance(request(body, headers), res);
    assert.equal(res.status, expected);
  }
  assert.equal(mock.mock.callCount(), 0);
  const res = response();
  await handleGuidance(request('{"question":"sleep"}'), res);
  assert.equal(res.status, 502);
});
test('guidance keeps upstream failures recoverable', async t => {
  t.mock.method(globalThis, 'fetch', async () => { throw Error('offline'); });
  const res = response();
  await handleGuidance(request('{"question":"sleep"}'), res);
  assert.equal(res.status, 503);
});
