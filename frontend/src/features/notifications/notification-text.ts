import type { ApiNotification } from "@/shared/api";
import type { TranslationParams } from "@/shared/i18n";
import { dateText, moneyFromMinorUnits, transactionDateText } from "@/shared/lib/wallet";

/** Transfer notices use the receipt's UTC time in both notification views. */
export function notificationDateText(
  notification: Pick<ApiNotification, "kind" | "createdAt">,
): string {
  return notification.kind === "transfer_sent" || notification.kind === "transfer_received"
    ? transactionDateText(notification.createdAt)
    : dateText(notification.createdAt);
}

/**
 * The title and body of one notice in the reader's language.
 *
 * Transfer notices carry structured money facts (`data`) alongside the stored English strings, so
 * known kinds render from the dictionary with exact minor-unit amounts. Anything else — older rows
 * written before `data` existed, or kinds without params — falls back to the stored strings rather
 * than a blank or a guess.
 */
export function notificationText(
  item: Pick<ApiNotification, "kind" | "title" | "body" | "data">,
  t: (
    key:
      | "transfer.sent.title"
      | "transfer.sent.body"
      | "transfer.received.title"
      | "transfer.received.body",
    params?: TranslationParams,
  ) => string,
): { title: string; body: string } {
  const data = item.data;
  if (item.kind === "transfer_sent" && data?.direction === "sent") {
    return {
      title: t("transfer.sent.title"),
      body: t("transfer.sent.body", {
        amount: moneyFromMinorUnits(data.amountMinor),
        fee: moneyFromMinorUnits(data.feeMinor),
        address: data.counterpartyAddress,
      }),
    };
  }
  if (item.kind === "transfer_received" && data?.direction === "received") {
    return {
      title: t("transfer.received.title"),
      body: t("transfer.received.body", {
        amount: moneyFromMinorUnits(data.amountMinor),
        address: data.counterpartyAddress,
      }),
    };
  }
  return { title: item.title, body: item.body };
}
