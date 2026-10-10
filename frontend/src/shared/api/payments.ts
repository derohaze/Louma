import { api } from "@/shared/api";

export type PaymentMode = "test" | "live";
export interface DeveloperAccess {
  eligible: boolean;
  /** Added for deployment-selected routing; optional while older API processes are still running. */
  mode?: PaymentMode;
  available?: boolean;
  gateway_url?: string | null;
  /** Legacy response shape returned by a backend process started before deployment-selected routing. */
  environments?: Record<PaymentMode, boolean>;
}
export interface MerchantApplication {
  id: string;
  name: string;
  receiving_wallet_id: string;
  image_url?: string;
  status: string;
  domains: string[];
}
export interface GatewayResource {
  id: string;
  status?: string;
  name?: string;
  description?: string;
  amount?: string;
  amount_minor?: number;
  total?: string;
  url?: string;
  checkout_url?: string;
  created_at?: string;
  expires_at?: string;
  scopes?: string[];
  prefix?: string;
  payment_id?: string;
  interval?: string;
  [key: string]: unknown;
}
export interface GatewayPage<T> {
  data: T[];
  next_cursor: string | null;
}
export interface GatewayUsage {
  requests: number;
  errors: number;
  rate_limit_per_minute: number;
  environment: PaymentMode;
}
export interface CheckoutDetails {
  id: string;
  payment_id: string;
  status: string;
  intent_hash: string;
  currency: "LMA";
  total: string;
  subtotal: string;
  tax: string;
  fee: string;
  merchant_net: string;
  description: string;
  expires_at: string;
  subscription_id?: string;
  transaction_reference?: string;
  merchant: { id: string; name: string; image?: string };
  payer_wallet: { id: string; address: string; status: string } | null;
  recurring?: {
    price_id: string;
    amount: string;
    interval: string;
    consent_policy_version: string;
    description: string;
  } | null;
}

export const paymentApi = {
  access: () => api.get<DeveloperAccess>("/api/v1/developer/access"),
  applications: (mode: PaymentMode) =>
    api.get<GatewayPage<MerchantApplication>>(`/api/v1/developer/applications?mode=${mode}`),
  createApplication: (
    mode: PaymentMode,
    application: { name: string; wallet_id: string; domains: string[] },
    key: string,
  ) =>
    api.post<MerchantApplication>(
      "/api/v1/developer/applications",
      { mode, ...application },
      { idempotencyKey: key },
    ),
  updateApplication: (
    mode: PaymentMode,
    id: string,
    changes: {
      status?: "active" | "disabled";
      name?: string;
      domains?: string[];
      wallet_id?: string;
      image_url?: string;
    },
  ) => api.patch<MerchantApplication>(`/api/v1/developer/applications/${id}`, { mode, ...changes }),
  resources: (mode: PaymentMode, applicationId: string, resource: string, cursor?: string) =>
    api.get<GatewayPage<GatewayResource>>(
      `/api/v1/developer/applications/${applicationId}/${resource}?mode=${mode}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
    ),
  usage: (mode: PaymentMode, applicationId: string) =>
    api.get<GatewayUsage>(`/api/v1/developer/applications/${applicationId}/usage?mode=${mode}`),
  createResource: (
    mode: PaymentMode,
    applicationId: string,
    resource: string,
    payload: Record<string, unknown>,
    key: string,
  ) =>
    api.post<GatewayResource>(
      `/api/v1/developer/applications/${applicationId}/${resource}`,
      { mode, payload },
      { idempotencyKey: key },
    ),
  action: (
    mode: PaymentMode,
    resource: string,
    id: string,
    action: string,
    key: string,
    additional: Record<string, unknown> = {},
  ) =>
    api.post<GatewayResource>(
      `/api/v1/developer/${resource}/${id}/${action}`,
      { mode, ...additional },
      { idempotencyKey: key },
    ),
  checkout: (mode: PaymentMode, id: string) =>
    api.get<CheckoutDetails>(`/api/v1/payments/checkout/${id}?mode=${mode}`),
  cancelSubscription: (mode: PaymentMode, id: string, key: string) =>
    api.post<{ status: "canceled" }>(
      `/api/v1/payments/subscriptions/${id}/cancel`,
      { mode },
      { idempotencyKey: key },
    ),
  confirm: (
    mode: PaymentMode,
    id: string,
    proof: {
      intent_hash: string;
      transferPassword?: string;
      twoFactorCode?: string;
      recurring_consent?: boolean;
      policy_version?: string;
    },
    key: string,
  ) =>
    api.post<CheckoutDetails>(
      `/api/v1/payments/checkout/${id}/confirm`,
      { mode, ...proof },
      { idempotencyKey: key },
    ),
};
