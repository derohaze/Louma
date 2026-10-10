// Local educational integration: node payment-gateway/examples/html-backend.mjs
// Keep LOUMA_API_KEY server-side. Restart discards demo orders; a real merchant
// persists authenticated order ownership, idempotency keys and fulfillment state.
import { createServer } from 'node:http';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { LoumaClient, GatewayError } from '../sdk/javascript/index.js';

const client = new LoumaClient({
  apiKey: process.env.LOUMA_API_KEY ?? (process.env.LMA_API_KEY_FILE ? readFileSync(process.env.LMA_API_KEY_FILE, 'utf8').trim() : ''),
  baseURL: process.env.LOUMA_BASE_URL ?? 'http://127.0.0.1:8000',
});
const page = readFileSync(new URL('./html-backend.html', import.meta.url), 'utf8');
const orders = new Map();
const equal = (left, right) => Buffer.byteLength(left) === Buffer.byteLength(right) && timingSafeEqual(Buffer.from(left), Buffer.from(right));
const server = createServer(async (request, response) => {
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('Content-Security-Policy', "default-src 'none'; form-action 'self'; frame-ancestors 'none'");
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Referrer-Policy', 'no-referrer');
  try {
    for (const [id, order] of orders) if (order.expires < Date.now()) orders.delete(id);
    const cookies = Object.fromEntries((request.headers.cookie ?? '').split(';').map(item => item.trim().split('=')));
    let session = cookies.demo_order;
    let order = orders.get(session);
    if (!order && request.url === '/' && request.method === 'GET') {
      if (orders.size >= 256) { response.writeHead(503); response.end('Demo busy'); return; }
      session = randomUUID();
      order = { csrf: randomUUID(), key: randomUUID(), expires: Date.now() + 3600000 };
      orders.set(session, order);
      response.setHeader('Set-Cookie', `demo_order=${session}; HttpOnly; SameSite=Lax; Path=/; Max-Age=3600`);
    }
    if (!order) { response.writeHead(401); response.end('Open the order page first'); return; }
    if (request.url === '/' && request.method === 'GET') {
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      response.end(page.replace('{{csrf}}', order.csrf));
      return;
    }
    if (request.url === '/api/merchant/checkout' && request.method === 'POST') {
      let raw = '';
      for await (const chunk of request) {
        raw += chunk.toString('utf8');
        if (Buffer.byteLength(raw) > 1024) { response.writeHead(413); response.end('Request too large'); return; }
      }
      const csrf = new URLSearchParams(raw).get('csrf') ?? '';
      if (!equal(csrf, order.csrf)) { response.writeHead(403); response.end('Invalid form token'); return; }
      const checkout = await client.createCheckout({ subtotal: '100.0000', tax: '0.0000', currency: 'LMA', description: 'Example order 42' }, order.key);
      order.paymentId = checkout.id;
      response.writeHead(303, { Location: checkout.checkout_url });
      response.end();
      return;
    }
    if (request.url === '/status' && request.method === 'GET') {
      if (!order.paymentId) { response.writeHead(200); response.end('No payment started'); return; }
      const payment = await client.retrievePayment(order.paymentId);
      // The browser redirect cannot grant access: only this authoritative read can.
      response.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end(payment.status === 'succeeded' ? `Payment verified: ${payment.transaction_reference}` : `Payment status: ${payment.status}`);
      return;
    }
    response.writeHead(404); response.end('Not found');
  } catch (error) {
    response.writeHead(error instanceof GatewayError ? 502 : 500);
    response.end(error instanceof GatewayError ? `Gateway error: ${error.code}` : 'Request failed');
  }
});
server.listen(Number(process.env.PORT ?? 8098), '127.0.0.1', () => console.log('Local merchant example listening on loopback'));
