import type { FeePolicy } from "./money.js";
export interface Application {
  idempotencyKey: string;
  requestFingerprint: string;
  publicId: string;
  ownerUserId: string;
  name: string;
  walletId: string;
  domains: string[];
  imageUrl?: string;
  status: string;
  version: number;
  createdAt: Date;
}
export interface Credential {
  publicId: string;
  applicationId: string;
  hash: string;
  prefix: string;
  scopes: string[];
  status: string;
  expiresAt: Date | null;
  version: number;
  createdAt: Date;
}
export interface CheckoutInput {
  subtotal: string;
  tax: string;
  currency: string;
  description: string;
  success_url: string;
  cancel_url: string;
  price_id: string;
  metadata: Record<string, string>;
}
export interface Payment {
  publicId: string;
  applicationId: string;
  credentialId: string;
  receivingWalletId: string;
  merchantName: string;
  subtotalMinor: number;
  taxMinor: number;
  totalMinor: number;
  feeMinor: number;
  netMinor: number;
  feePolicy: FeePolicy;
  description: string;
  status: string;
  idempotencyKey: string;
  requestFingerprint: string;
  intentHash: string;
  payerUserId: string;
  payerWalletId: string;
  transactionId: string;
  refundedMinor: number;
  priceId: string;
  interval: string;
  subscriptionId: string;
  invoiceId: string;
  successUrl: string;
  cancelUrl: string;
  metadata: Record<string, string>;
  createdAt: Date;
  expiresAt: Date;
}
export interface Proof {
  kind: string;
  timeStep: number;
  passwordChangedAt: Date | null;
  twoFactorEnabledAt: Date | null;
  credentialId: string;
  verifiedHashes: string[];
  remainingHashes: string[];
}
export interface Approval {
  publicId: string;
  paymentId: string;
  ownerUserId: string;
  walletId: string;
  sessionId: string;
  intentHash: string;
  idempotencyKey: string;
  proof: Proof;
  recurringConsent: boolean;
  policyVersion: string;
  consumed: boolean;
  expiresAt: Date;
  createdAt: Date;
}
export interface Wallet {
  publicId: string;
  ownerUserId: string;
  address: string;
  status: string;
  financialVersion: number;
}
export interface Account {
  publicId: string;
  walletId: string | null;
  accountType: string;
  currency: string;
  balanceMinor: number;
}
export interface Product {
  description: string;
  publicId: string;
  applicationId: string;
  name: string;
  status: string;
  createdAt: Date;
}
export interface Price {
  publicId: string;
  applicationId: string;
  productId: string;
  amountMinor: number;
  interval: string;
  version: number;
  status: string;
  createdAt: Date;
}
export interface Subscription {
  receivingWalletId: string;
  publicId: string;
  applicationId: string;
  payerUserId: string;
  payerWalletId: string;
  priceId: string;
  priceVersion: number;
  amountMinor: number;
  interval: string;
  status: string;
  mandateActive: boolean;
  consentAt: Date;
  policyVersion: string;
  anchorAt: Date;
  cycle: number;
  dueAt: Date;
  cancelAtEnd: boolean;
  version: number;
  createdAt: Date;
}
export interface Invoice {
  feeMinor: number;
  feePolicy: FeePolicy;
  publicId: string;
  applicationId: string;
  subscriptionId: string;
  cycle: number;
  amountMinor: number;
  status: string;
  paymentId: string;
  periodStart: Date;
  periodEnd: Date;
  dueAt: Date;
  attempts: number;
  leaseUntil: Date;
  fence: number;
  createdAt: Date;
}
export interface Refund {
  reason: string;
  publicId: string;
  applicationId: string;
  paymentId: string;
  amountMinor: number;
  status: string;
  idempotencyKey: string;
  requestFingerprint: string;
  transactionId: string;
  createdAt: Date;
}
export interface Link {
  publicId: string;
  applicationId: string;
  input: CheckoutInput;
  status: string;
  createdAt: Date;
}
export interface Endpoint {
  publicId: string;
  applicationId: string;
  url: string;
  events: string[];
  encryptedSecret: string;
  status: string;
  createdAt: Date;
}
export interface Event {
  publicId: string;
  applicationId: string;
  type: string;
  resourceId: string;
  createdAt: Date;
  expanded: boolean;
}
export interface Delivery {
  publicId: string;
  applicationId: string;
  eventId: string;
  endpointId: string;
  status: string;
  attempts: number;
  dueAt: Date;
  leaseUntil: Date;
  fence: number;
  lastStatus: number;
  createdAt: Date;
}
export const publicFields: Record<string, Record<string, string>> = {
  Application: {
    publicId: "id",
    name: "name",
    walletId: "receiving_wallet_id",
    domains: "domains",
    imageUrl: "image_url",
    status: "status",
    createdAt: "created_at",
  },
  Credential: {
    publicId: "id",
    applicationId: "application_id",
    prefix: "prefix",
    scopes: "scopes",
    status: "status",
    expiresAt: "expires_at",
    createdAt: "created_at",
  },
  CheckoutInput: {},
  Payment: {},
  Proof: {
    kind: "kind",
    timeStep: "timeStep",
    passwordChangedAt: "passwordChangedAt",
    twoFactorEnabledAt: "twoFactorEnabledAt",
    credentialId: "credentialId",
    verifiedHashes: "verifiedHashes",
    remainingHashes: "remainingHashes",
  },
  Approval: {
    publicId: "id",
    paymentId: "payment_id",
    ownerUserId: "owner_user_id",
    walletId: "wallet_id",
    sessionId: "session_id",
    intentHash: "intent_hash",
    idempotencyKey: "idempotency_key",
    proof: "proof",
    recurringConsent: "recurring_consent",
    policyVersion: "policy_version",
    expiresAt: "expires_at",
  },
  Wallet: {},
  Account: {},
  Product: {
    description: "description",
    publicId: "id",
    applicationId: "application_id",
    name: "name",
    status: "status",
    createdAt: "created_at",
  },
  Price: {
    publicId: "id",
    applicationId: "application_id",
    productId: "product_id",
    amountMinor: "amount_minor",
    interval: "interval",
    version: "version",
    status: "status",
    createdAt: "created_at",
  },
  Subscription: {
    publicId: "id",
    applicationId: "application_id",
    priceId: "price_id",
    priceVersion: "price_version",
    amountMinor: "amount_minor",
    interval: "interval",
    status: "status",
    mandateActive: "mandate_active",
    consentAt: "consent_at",
    policyVersion: "policy_version",
    anchorAt: "anchor_at",
    cycle: "cycle",
    dueAt: "due_at",
    cancelAtEnd: "cancel_at_period_end",
    createdAt: "created_at",
  },
  Invoice: {
    feeMinor: "fee_minor",
    feePolicy: "fee_policy",
    publicId: "id",
    applicationId: "application_id",
    subscriptionId: "subscription_id",
    cycle: "cycle",
    amountMinor: "amount_minor",
    status: "status",
    paymentId: "payment_id",
    periodStart: "period_start",
    periodEnd: "period_end",
    dueAt: "due_at",
    attempts: "attempts",
    createdAt: "created_at",
  },
  Refund: {
    reason: "reason",
    publicId: "id",
    applicationId: "application_id",
    paymentId: "payment_id",
    amountMinor: "amount_minor",
    status: "status",
    transactionId: "transaction_reference",
    createdAt: "created_at",
  },
  Link: {
    publicId: "id",
    applicationId: "application_id",
    input: "checkout",
    status: "status",
    createdAt: "created_at",
  },
  Endpoint: {
    publicId: "id",
    applicationId: "application_id",
    url: "url",
    events: "events",
    status: "status",
    createdAt: "created_at",
  },
  Event: {
    publicId: "id",
    applicationId: "application_id",
    type: "type",
    resourceId: "resource_id",
    createdAt: "created_at",
  },
  Delivery: {
    publicId: "id",
    applicationId: "application_id",
    eventId: "event_id",
    endpointId: "endpoint_id",
    status: "status",
    attempts: "attempts",
    dueAt: "due_at",
    lastStatus: "last_status",
    createdAt: "created_at",
  },
};
