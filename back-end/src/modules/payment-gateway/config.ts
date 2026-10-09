export type GatewayMode = "test" | "live";

export interface GatewayConnection {
  url: string;
  serviceKey: string;
}

export interface PaymentGatewayConfig {
  test: GatewayConnection | null;
  live: GatewayConnection | null;
}

export function loadPaymentGatewayConfig(values: NodeJS.ProcessEnv): PaymentGatewayConfig {
  const connection = (mode: GatewayMode): GatewayConnection | null => {
    const prefix = `PAYMENT_GATEWAY_${mode.toUpperCase()}`;
    const rawUrl = values[`${prefix}_URL`]?.trim();
    const serviceKey = values[`${prefix}_SERVICE_KEY`];
    if (!rawUrl && !serviceKey) return null;
    if (!rawUrl || !serviceKey || Buffer.byteLength(serviceKey) < 32) {
      throw new Error(`${prefix}_URL and a SERVICE_KEY of at least 32 bytes are required together`);
    }
    const parsed = new URL(rawUrl);
    const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname);
    if ((parsed.protocol !== "https:" && !(parsed.protocol === "http:" && loopback && values["NODE_ENV"] !== "production")) || parsed.username || parsed.password || parsed.search || parsed.hash || parsed.pathname !== "/") {
      throw new Error(`${prefix}_URL must be an HTTPS origin; development HTTP is limited to loopback`);
    }
    return { url: parsed.origin, serviceKey };
  };
  const configured = { test: connection("test"), live: connection("live") };
  if (configured.test && configured.live && (configured.test.url === configured.live.url || configured.test.serviceKey === configured.live.serviceKey)) {
    throw new Error("Payment gateway test and live origins and service keys must be distinct");
  }
  return configured;
}
