import { createHash, createHmac, randomUUID } from "node:crypto";
import { AppError, serviceUnavailable } from "../../shared/errors.js";
import type { GatewayConnection } from "./config.js";

export function gatewaySignature(input: {
  serviceKey: string; timestamp: string; nonce: string; method: string; requestUri: string; ownerUserId: string; rawBody: string;
}): string {
  const bodyHash = createHash("sha256").update(input.rawBody).digest("hex");
  return createHmac("sha256", input.serviceKey)
    .update([input.timestamp, input.nonce, input.method, input.requestUri, input.ownerUserId, bodyHash].join("\n"))
    .digest("hex");
}

export async function gatewayRequest<T>(input: {
  connection: GatewayConnection | null; ownerUserId: string; method: "GET" | "POST" | "PATCH"; path: string; body?: unknown;
}): Promise<T> {
  if (!input.connection) throw serviceUnavailable("payment_gateway_disabled", "Payments are unavailable in this environment.");
  const rawBody = input.body === undefined ? "" : JSON.stringify(input.body);
  const timestamp = String(Math.floor(Date.now() / 1000));
  const nonce = randomUUID();
  let response: Response;
  try {
    response = await fetch(`${input.connection.url}${input.path}`, {
      method: input.method,
      headers: {
        "Content-Type": "application/json",
        "X-Louma-Timestamp": timestamp,
        "X-Louma-Nonce": nonce,
        "X-Louma-User": input.ownerUserId,
        "X-Louma-Signature": gatewaySignature({ serviceKey: input.connection.serviceKey, timestamp, nonce, method: input.method, requestUri: input.path, ownerUserId: input.ownerUserId, rawBody }),
      },
      ...(rawBody ? { body: rawBody } : {}),
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw serviceUnavailable("payment_gateway_unavailable", "The payment service is unavailable. Retry with the same request key.");
  }
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const failure = payload && typeof payload === "object" && "error" in payload
      ? (payload as { error?: { code?: unknown; message?: unknown } }).error : undefined;
    throw new AppError(response.status, typeof failure?.code === "string" ? failure.code : "payment_gateway_error", typeof failure?.message === "string" ? failure.message : "The payment request could not be completed.");
  }
  if (!payload || typeof payload !== "object") throw serviceUnavailable("payment_gateway_invalid_response", "The payment service returned an invalid response.");
  return payload as T;
}
