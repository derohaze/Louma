export type Money = string;
export type Environment = 'test' | 'live';
export type Resource = { id: string; status: string; [field: string]: unknown };
export type Page<T = Resource> = { data: T[]; next_cursor: string | null };
export type Pagination = { cursor?: string };
export interface CheckoutInput { subtotal: Money; tax: Money; currency: 'LMA'; description: string; success_url?: string; cancel_url?: string; price_id?: string; metadata?: Record<string, string>; }
export interface SubscriptionInput { price_id: string; description?: string; currency: 'LMA'; success_url?: string; cancel_url?: string; metadata?: Record<string, string>; }
export interface Payment extends Resource { payment_id: string; intent_hash: string; currency: 'LMA'; subtotal: Money; tax: Money; total: Money; fee: Money; merchant_net: Money; merchant: {id: string; name: string}; expires_at: string; metadata?: Record<string, string>; recurring?: {price_id: string; amount: Money; interval: 'month' | 'year'; consent_policy_version: string}; }
export interface Checkout extends Payment { checkout_url: string; }
export interface PriceInput { product_id: string; amount: Money; currency: 'LMA'; interval: 'one_time' | 'monthly' | 'yearly' | 'month' | 'year' | ''; }
export class GatewayError extends Error { status: number; code: string; requestId: string; }
export function verifyWebhook(secret: string, rawBody: string | Uint8Array, signature: string, now?: number): boolean;
export class LoumaClient {
  constructor(options: {apiKey: string; baseURL: string; environment?: Environment; timeout?: number});
  readonly environment: Environment;
  request<T = Resource>(method: string, path: string, options?: {body?: unknown; idempotencyKey?: string; query?: Pagination}): Promise<T>;
  createCheckout(body: CheckoutInput, idempotencyKey: string): Promise<Checkout>;
  retrieveCheckout(id: string): Promise<Checkout>;
  expireCheckout(id: string): Promise<Payment>;
  retrievePayment(id: string): Promise<Payment>;
  listPayments(query?: Pagination): Promise<Page<Payment>>;
  createLink(body: CheckoutInput, idempotencyKey?: string): Promise<Resource>;
  retrieveLink(id: string): Promise<Resource>;
  listLinks(query?: Pagination): Promise<Page>;
  updateLink(id: string, status: 'disabled'): Promise<Resource>;
  createProduct(body: {name: string; description?: string}): Promise<Resource>;
  listProducts(query?: Pagination): Promise<Page>;
  createPrice(body: PriceInput): Promise<Resource>;
  listPrices(query?: Pagination): Promise<Page>;
  createSubscription(body: SubscriptionInput, idempotencyKey: string): Promise<Checkout>;
  retrieveSubscription(id: string): Promise<Resource>;
  listSubscriptions(query?: Pagination): Promise<Page>;
  cancelSubscription(id: string, atPeriodEnd?: boolean): Promise<Resource>;
  retrieveInvoice(id: string): Promise<Resource>;
  listInvoices(query?: Pagination): Promise<Page>;
  createRefund(body: {payment_id: string; amount: Money}, idempotencyKey: string): Promise<Resource>;
  retrieveRefund(id: string): Promise<Resource>;
  listRefunds(query?: Pagination): Promise<Page>;
  createWebhook(body: {url: string; events: string[]}): Promise<{id: string; endpoint: Resource; signing_secret: string}>;
  listWebhooks(query?: Pagination): Promise<Page>;
  listDeliveries(query?: Pagination): Promise<Page>;
  retrieveDelivery(id: string): Promise<Resource>;
  retryDelivery(id: string): Promise<Resource>;
  disableLink(id: string): Promise<Resource>;
  disableWebhook(id: string): Promise<Resource>;
  rotateWebhook(id: string): Promise<{id: string; signing_secret: string}>;
  createCredential(body: {scopes: string[]; expires_at?: string}): Promise<{id: string; credential: Resource; api_key: string}>;
  rotateCredential(id: string): Promise<{id: string; credential: Resource; api_key: string}>;
  revokeCredential(id: string): Promise<Resource>;
}
