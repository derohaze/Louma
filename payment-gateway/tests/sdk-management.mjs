// Supplemental real API checks for newly added management actions.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHmac, randomUUID } from 'node:crypto';
import { LoumaClient, GatewayError, verifyWebhook } from '../sdk/javascript/index.js';

const apiKey = readFileSync(process.env.LMA_API_KEY_FILE, 'utf8').trim();
assert.ok(apiKey.startsWith('lma_test_'));
const baseURL = process.env.LMA_BASE_URL ?? 'http://127.0.0.1:8090';
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(new URL(baseURL).hostname), 'local test gateway required');
const client = new LoumaClient({ apiKey, baseURL });
const credential = await client.createCredential({ scopes: ['payments:read'] });
const restricted = new LoumaClient({ apiKey: credential.api_key, baseURL });
assert.ok(Array.isArray((await restricted.listPayments()).data));
await assert.rejects(restricted.createCheckout({ subtotal: '1.0000', tax: '0.0000', currency: 'LMA', description: 'Scope check' }, randomUUID()), error => error instanceof GatewayError && error.status === 403);
const rotated = await client.rotateCredential(credential.id);
assert.ok(rotated.api_key.startsWith('lma_test_'));
await assert.rejects(restricted.listPayments(), error => error instanceof GatewayError && error.status === 401);
const replacement = new LoumaClient({ apiKey: rotated.api_key, baseURL });
assert.ok(Array.isArray((await replacement.listPayments()).data));
assert.equal((await client.revokeCredential(rotated.id)).status, 'revoked');
await assert.rejects(replacement.listPayments(), error => error instanceof GatewayError && error.status === 401);
// Reserved invalid DNS name; no delivery or external receiver connection is made.
const endpoint = await client.createWebhook({ url: 'https://receiver.example.invalid/louma', events: ['payment.succeeded'] });
assert.ok(endpoint.signing_secret);
const rotatedWebhook = await client.rotateWebhook(endpoint.id);
assert.ok(rotatedWebhook.signing_secret !== endpoint.signing_secret, 'signing secret must rotate');
const raw = Buffer.from('{"id":"test-event"}');
const now = Math.floor(Date.now() / 1000);
const signature = `t=${now},v1=${createHmac('sha256', rotatedWebhook.signing_secret).update(`${now}.`).update(raw).digest('hex')}`;
assert.ok(verifyWebhook(rotatedWebhook.signing_secret, raw, signature, now));
assert.equal(verifyWebhook(endpoint.signing_secret, raw, signature, now), false);
assert.equal((await client.disableWebhook(endpoint.id)).status, 'disabled');
console.log('SDK management: scoped credential creation, rotation/revocation, webhook rotation/disable passed');
