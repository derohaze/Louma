import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createHmac } from 'node:crypto';
import { LoumaClient, GatewayError, verifyWebhook } from '../sdk/javascript/index.js';

test('webhook raw bytes, skew boundaries, malformed signature and wrong secret', () => {
  const body = Buffer.from('{"message":"اشتراك"}');
  const now = 1700000000;
  const signed = timestamp => `t=${timestamp},v1=${createHmac('sha256', 'fixture-secret').update(`${timestamp}.`).update(body).digest('hex')}`;
  for (const timestamp of [now, now - 300, now + 30]) assert.equal(verifyWebhook('fixture-secret', body, signed(timestamp), now), true);
  for (const timestamp of [now - 301, now + 31]) assert.equal(verifyWebhook('fixture-secret', body, signed(timestamp), now), false);
  assert.equal(verifyWebhook('wrong', body, signed(now), now), false);
  assert.equal(verifyWebhook('fixture-secret', Buffer.from('{}'), signed(now), now), false);
  for (const signature of ['', 't=no,v1=bad', signed(now) + '\n', null]) assert.equal(verifyWebhook('fixture-secret', body, signature, now), false);
});

test('reject environment confusion, insecure endpoint and invalid timeout', () => {
  assert.equal(new LoumaClient({ apiKey: 'lma_live_fixture', baseURL: 'https://example.com' }).environment, 'live');
  for (const options of [{ environment: 'live' }, { baseURL: 'http://example.com' }, { baseURL: 'https://user@example.com' }, { baseURL: 'https://example.com?secret=x' }, { timeout: NaN }, { timeout: 0 }]) {
    assert.throws(() => new LoumaClient({ apiKey: 'lma_test_fixture', baseURL: 'http://127.0.0.1', ...options }), TypeError);
  }
});

test('malformed JSON resources always produce a typed error', async t => {
  const server = createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(req.url === '/v1/payments/null' ? 'null' : req.url === '/v1/payments/array' ? '[]' : '{broken'); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const client = new LoumaClient({ apiKey: 'lma_test_fixture', baseURL: `http://127.0.0.1:${server.address().port}` });
  assert.equal(JSON.stringify(client).includes('lma_test_fixture'), false);
  for (const id of ['null', 'array', 'broken']) await assert.rejects(client.retrievePayment(id), error => error instanceof GatewayError && error.code === 'invalid_response' && error.status === 200);
});

test('structured HTTP errors preserve status, code and request ID; redirects are rejected', async t => {
  const server = createServer((req, res) => {
    if (req.url === '/v1/payments/redirect') { res.writeHead(302, { Location: '/target' }); res.end(); return; }
    res.writeHead(429, { 'Content-Type': 'application/json', 'X-Request-ID': 'fixture-request' });
    res.end(JSON.stringify({ error: { code: 'rate_limit_exceeded', message: 'rate limit exceeded', request_id: 'fixture-request' } }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const client = new LoumaClient({ apiKey: 'lma_test_fixture', baseURL: `http://127.0.0.1:${server.address().port}` });
  await assert.rejects(client.listPayments(), error => error instanceof GatewayError && error.status === 429 && error.code === 'rate_limit_exceeded' && error.requestId === 'fixture-request');
  await assert.rejects(client.retrievePayment('redirect'), error => error instanceof GatewayError && error.code === 'transport_error');
});
