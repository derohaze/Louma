import type { ApiTransaction } from "@/shared/api";
import { dateText } from "./wallet-format";

/**
 * Statement exports: CSV files generated in the browser from API data.
 *
 * No backend change needed — the exporters page through the existing
 * cursor-paged endpoints, so a statement covers the whole history, not just
 * the rows the current screen has loaded.
 */

function csvCell(value: string): string {
  // A sender-controlled note can begin with `=`, `+`, `-`, or `@`: without neutralising the
  // formula prefix, opening the export in a spreadsheet interprets the sender's text as a
  // formula. Prefixing with `'` keeps the text visible while preventing evaluation.
  const safe = /^[=+\-@]/.test(value) ? `'${value}` : value;
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

function toCsv(headers: string[], rows: string[][]): string {
  return [headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n");
}

export function downloadCsv(filename: string, csv: string): void {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export function transactionsToCsv(transactions: ApiTransaction[], userId: string | null): string {
  return toCsv(
    ["Date", "Direction", "Counterparty", "Amount (LMA)", "Fee (LMA)", "Net (LMA)", "Transfer ID"],
    transactions.map((tx) => [
      dateText(tx.createdAt),
      tx.direction,
      tx.counterpartyAddress,
      tx.amount,
      tx.fee,
      tx.netAmount,
      tx.transferId,
    ]),
  );
}
