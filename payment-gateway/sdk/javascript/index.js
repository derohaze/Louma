import { createHmac, timingSafeEqual } from 'node:crypto';

export class GatewayError extends Error {
  constructor(status, code, message, requestId = '') {
    super(message);
    this.name = 'GatewayError';
    this.status = status;
    this.code = code;
    this.requestId = requestId;
  }
}

export function verifyWebhook(secret, rawBody, signature, now = Math.floor(Date.now() / 1000)) {
  const parts = /^t=(\d+),v1=([a-f0-9]{64})$/.exec(signature ?? '');
  if (!parts || !secret) return false;
  const timestamp = Number(parts[1]);
  if (!Number.isSafeInteger(timestamp) || timestamp < now - 300 || timestamp > now + 30) return false;
  const expected = createHmac('sha256', secret).update(`${parts[1]}.`).update(rawBody).digest();
  return timingSafeEqual(expected, Buffer.from(parts[2], 'hex'));
}

export class LoumaClient {
  constructor({ apiKey, baseURL, environment = apiKey?.startsWith('lma_live_') ? 'live' : 'test', timeout = 10000 }) {
    if (!['test', 'live'].includes(environment) || !apiKey?.startsWith(`lma_${environment}_`)) throw new TypeError('API key environment mismatch');
    const endpoint = new URL(baseURL);
    const local = ['127.0.0.1', 'localhost', '[::1]'].includes(endpoint.hostname);
    if (endpoint.username || endpoint.password || endpoint.search || endpoint.hash || (endpoint.protocol !== 'https:' && !(environment === 'test' && local && endpoint.protocol === 'http:'))) throw new TypeError('HTTPS baseURL required outside local test mode');
    if (!Number.isFinite(timeout) || timeout <= 0) throw new TypeError('timeout must be positive milliseconds');
    this.baseURL = endpoint.toString().replace(/\/$/, '');
    this.timeout = timeout;
    this.environment = environment;
    Object.defineProperty(this, 'apiKey', { value: apiKey });
  }

  async request(method, path, { body, idempotencyKey, query } = {}) {
    const endpoint = new URL(`${this.baseURL}${path}`);
    for (const [name, parameter] of Object.entries(query ?? {})) if (parameter !== undefined && parameter !== null) endpoint.searchParams.set(name, String(parameter));
    const headers = { Authorization: `Bearer ${this.apiKey}`, Accept: 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
    let response;
    try {
      response = await fetch(endpoint, { method, headers, redirect: 'error', signal: AbortSignal.timeout(this.timeout), ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
    } catch {
      throw new GatewayError(0, 'transport_error', 'Gateway request failed; reconcile before retrying');
    }
    let resource;
    try { resource = await response.json(); } catch { throw new GatewayError(response.status, 'invalid_response', 'Gateway returned invalid JSON'); }
    if (!resource || typeof resource !== 'object' || Array.isArray(resource)) throw new GatewayError(response.status, 'invalid_response', 'Gateway returned invalid resource');
    if (!response.ok) throw new GatewayError(response.status, resource.error?.code ?? 'http_error', resource.error?.message ?? 'Gateway request rejected', resource.error?.request_id ?? response.headers.get('x-request-id') ?? '');
    return resource;
  }

  createCheckout(body, idempotencyKey) { return this.request('POST', '/v1/checkouts', { body, idempotencyKey }); }
  retrieveCheckout(id) { return this.request('GET', `/v1/checkouts/${encodeURIComponent(id)}`); }
  expireCheckout(id) { return this.request('POST', `/v1/checkouts/${encodeURIComponent(id)}/expire`, { body: {} }); }
  retrievePayment(id) { return this.request('GET', `/v1/payments/${encodeURIComponent(id)}`); }
  listPayments(query = {}) { return this.request('GET', '/v1/payments', { query }); }
  createLink(body, idempotencyKey) { return this.request('POST', '/v1/payment-links', { body, idempotencyKey }); }
  retrieveLink(id) { return this.request('GET', `/v1/payment-links/${encodeURIComponent(id)}`); }
  listLinks(query = {}) { return this.request('GET', '/v1/payment-links', { query }); }
  updateLink(id, status) { return this.request('PATCH', `/v1/payment-links/${encodeURIComponent(id)}`, { body: { status } }); }
  createProduct(body) { return this.request('POST', '/v1/products', { body }); }
  listProducts(query = {}) { return this.request('GET', '/v1/products', { query }); }
  createPrice(body) { return this.request('POST', '/v1/prices', { body }); }
  listPrices(query = {}) { return this.request('GET', '/v1/prices', { query }); }
  createSubscription(body, idempotencyKey) { return this.request('POST', '/v1/subscriptions', { body, idempotencyKey }); }
  retrieveSubscription(id) { return this.request('GET', `/v1/subscriptions/${encodeURIComponent(id)}`); }
  listSubscriptions(query = {}) { return this.request('GET', '/v1/subscriptions', { query }); }
  cancelSubscription(id, atPeriodEnd = true) { return this.request('POST', `/v1/subscriptions/${encodeURIComponent(id)}/cancel`, { body: { at_period_end: atPeriodEnd } }); }
  retrieveInvoice(id) { return this.request('GET', `/v1/invoices/${encodeURIComponent(id)}`); }
  listInvoices(query = {}) { return this.request('GET', '/v1/invoices', { query }); }
  createRefund(body, idempotencyKey) { return this.request('POST', '/v1/refunds', { body, idempotencyKey }); }
  retrieveRefund(id) { return this.request('GET', `/v1/refunds/${encodeURIComponent(id)}`); }
  listRefunds(query = {}) { return this.request('GET', '/v1/refunds', { query }); }
  createWebhook(body) { return this.request('POST', '/v1/webhooks', { body }); }
  listWebhooks(query = {}) { return this.request('GET', '/v1/webhooks', { query }); }
  listDeliveries(query = {}) { return this.request('GET', '/v1/webhook-deliveries', { query }); }
  retrieveDelivery(id) { return this.request('GET', `/v1/webhook-deliveries/${encodeURIComponent(id)}`); }
  retryDelivery(id) { return this.request('POST', `/v1/webhook-deliveries/${encodeURIComponent(id)}/retry`, { body: {} }); }
  disableLink(id) { return this.request('POST', `/v1/payment-links/${encodeURIComponent(id)}/disable`, { body: {} }); }
  disableWebhook(id) { return this.request('POST', `/v1/webhooks/${encodeURIComponent(id)}/disable`, { body: {} }); }
  rotateWebhook(id) { return this.request('POST', `/v1/webhooks/${encodeURIComponent(id)}/rotate`, { body: {} }); }
  createCredential(body) { return this.request('POST', '/v1/credentials', { body }); }
  rotateCredential(id) { return this.request('POST', `/v1/credentials/${encodeURIComponent(id)}/rotate`, { body: {} }); }
  revokeCredential(id) { return this.request('POST', `/v1/credentials/${encodeURIComponent(id)}/revoke`, { body: {} }); }
}
