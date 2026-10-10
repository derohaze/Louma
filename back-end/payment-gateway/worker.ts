import type { GatewayStore } from "./infrastructure/store.js";
import { claimInvoice, renew, schedule } from "./infrastructure/billing.js";
import {
  claimDelivery,
  deliveryPayload,
  expandEvents,
  finishDelivery,
} from "./infrastructure/webhooks.js";
import { decrypt, sendWebhook, signature } from "./security.js";
export interface WorkerLogger {
  warn(fields: object, message: string): void;
  error(fields: object, message: string): void;
}
export async function tick(
  store: GatewayStore,
  logger: WorkerLogger,
  stopping: () => boolean = () => false,
): Promise<void> {
  if (
    !store.config.billingPaused &&
    !store.config.settlementPaused &&
    !store.config.merchantPaused
  ) {
    await schedule(store, new Date());
    for (let i = 0; i < 16 && !stopping(); i++) {
      const invoice = await claimInvoice(store, new Date());
      if (!invoice) break;
      try {
        await renew(store, invoice, new Date());
      } catch {
        logger.warn({ invoiceId: invoice.publicId }, "invoice_retry_required");
      }
    }
  }
  if (stopping()) return;
  await expandEvents(store, new Date());
  for (let i = 0; i < 16 && !stopping(); i++) {
    const delivery = await claimDelivery(store, new Date());
    if (!delivery) break;
    let status = 0;
    try {
      const { endpoint, body } = await deliveryPayload(store, delivery);
      const key = decrypt(store.config.encryptionKey, endpoint.encryptedSecret);
      status = await sendWebhook(endpoint.url, body, {
        "Louma-Signature": signature(key, body),
        "Louma-Event-Id": delivery.eventId,
      });
    } catch {
      logger.warn({ deliveryId: delivery.publicId }, "webhook_delivery_failed");
    }
    await finishDelivery(store, delivery, status, new Date());
  }
}
export function startWorker(
  store: GatewayStore,
  logger: WorkerLogger,
): () => Promise<void> {
  let running: Promise<void> | null = null,
    stopped = false;
  const timer = setInterval(() => {
    if (stopped || running) return;
    running = tick(store, logger, () => stopped)
      .catch(() =>
        logger.error({ retryable: true }, "gateway_worker_tick_failed"),
      )
      .finally(() => {
        running = null;
      });
  }, 1000);
  timer.unref();
  return async () => {
    stopped = true;
    clearInterval(timer);
    await running;
  };
}
