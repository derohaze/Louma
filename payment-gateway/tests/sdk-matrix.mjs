// Real API contract checks. Only run against an isolated test gateway.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { LoumaClient, GatewayError } from '../sdk/javascript/index.js';

export async function runMatrix(Client = LoumaClient, language = 'Node.js') {
  const apiKey = readFileSync(process.env.LMA_API_KEY_FILE, 'utf8').trim();
  const baseURL = process.env.LMA_BASE_URL ?? 'http://127.0.0.1:8090';
  assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(new URL(baseURL).hostname), 'local test gateway required');
  assert.ok(apiKey.startsWith('lma_test_'), 'test key required');
  const client = new Client({ apiKey, baseURL, environment: 'test' });
  const key = randomUUID();
  const body = { subtotal: '2.1234', tax: '0.0000', currency: 'LMA', description: `SDK ${language}`, metadata: { suite: 'sdk-matrix' } };
  const checkout = await client.createCheckout(body, key);
  assert.equal(checkout.total, '2.1234');
  assert.equal(checkout.status, 'requires_action');
  assert.ok(checkout.checkout_url.endsWith(`/checkout/${checkout.id}`));
  assert.equal((await client.createCheckout(body, key)).id, checkout.id);
  assert.equal((await client.retrieveCheckout(checkout.id)).id, checkout.id);
  assert.equal((await client.retrievePayment(checkout.id)).id, checkout.id);
  const page = await client.listPayments();
  assert.ok(Array.isArray(page.data));
  assert.equal(typeof page.next_cursor, 'string');
  await assert.rejects(client.createCheckout({ ...body, subtotal: '3.0000' }, key), error => error instanceof GatewayError && error.status === 409 && error.code === 'idempotency_key_reused' && !!error.requestId);
  await assert.rejects(client.createCheckout({ ...body, subtotal: '-1' }, randomUUID()), error => error instanceof GatewayError && error.status === 400 && !!error.requestId);
  await assert.rejects(client.retrievePayment(randomUUID()), error => error instanceof GatewayError && error.status === 404 && !!error.requestId);
  const wrong = new Client({ apiKey: 'lma_test_invalid', baseURL });
  await assert.rejects(wrong.listPayments(), error => error instanceof GatewayError && error.status === 401);
  assert.throws(() => new Client({ apiKey, baseURL, environment: 'live' }));
  assert.throws(() => new Client({ apiKey, baseURL: 'http://example.com' }));
  const product = await client.createProduct({ name: `SDK ${language}` });
  const price = await client.createPrice({ product_id: product.id, amount: '1.0000', currency: 'LMA', interval: 'month' });
  assert.equal(price.amount_minor, 10000);
  const subKey = randomUUID();
  const subscriptionBody = { price_id: price.id, currency: 'LMA', description: 'Recurring SDK check' };
  const consent = await client.createSubscription(subscriptionBody, subKey);
  assert.equal(consent.recurring.interval, 'month');
  assert.equal((await client.createSubscription(subscriptionBody, subKey)).id, consent.id);
  assert.ok(Array.isArray((await client.listSubscriptions()).data));
  // A merchant creates a consent checkout; no mandate exists before payer approval.
  await assert.rejects(client.retrieveSubscription(consent.id), error => error instanceof GatewayError && error.status === 404);
  assert.equal((await client.expireCheckout(checkout.id)).status, 'canceled');
  assert.equal((await client.expireCheckout(consent.id)).status, 'canceled');
  console.log(`SDK matrix: ${language} passed checkout, billing, authentication and error checks against real test API`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await runMatrix();
