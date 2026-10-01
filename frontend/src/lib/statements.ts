import { api, type ApiMiningSession, type ApiTransaction } from "@/lib/api";
import { dateText } from "@/lib/wallet-format";
import { displayNote } from "@/lib/address-book";

/**
 * Statement exports: CSV files generated in the browser from API data.
 *
 * No backend change needed — the exporters page through the existing
 * cursor-paged endpoints, so a statement covers the whole history, not just
 * the rows the current screen has loaded.
 */

const MAX_EXPORT_ROWS = 2000;

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
    [
      "Date",
      "Direction",
      "Counterparty",
      "Amount (LMA)",
      "Fee (LMA)",
      "Net (LMA)",
      "Transfer ID",
      "Note",
    ],
    transactions.map((tx) => [
      dateText(tx.createdAt),
      tx.direction,
      tx.counterpartyAddress,
      tx.amount,
      tx.fee,
      tx.netAmount,
      tx.transferId,
      displayNote(tx.note, ""),
    ]),
  );
}

export function miningToCsv(sessions: ApiMiningSession[]): string {
  return toCsv(
    ["Cycle", "Status", "Started", "Ended", "Rate (LMA/h)", "Earned (LMA)", "Collected (LMA)"],
    sessions.map((session) => [
      String(session.cycleNumber),
      session.status,
      session.startedAt,
      session.endsAt,
      session.rate,
      session.accrued,
      session.settled,
    ]),
  );
}

/** Page through every transaction; capped so a huge history cannot hang the tab. */
export async function fetchAllTransactions(): Promise<ApiTransaction[]> {
  const all: ApiTransaction[] = [];
  let cursor: string | null = null;
  for (;;) {
    const page: { transactions: ApiTransaction[]; nextCursor: string | null } = await api.get<{
      transactions: ApiTransaction[];
      nextCursor: string | null;
    }>(`/api/v1/transactions?limit=50${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`);
    all.push(...page.transactions);
    cursor = page.nextCursor;
    if (!cursor || all.length >= MAX_EXPORT_ROWS) break;
  }
  return all.slice(0, MAX_EXPORT_ROWS);
}

/** Page through every mining cycle; same cap as transactions. */
export async function fetchAllMiningSessions(): Promise<ApiMiningSession[]> {
  const all: ApiMiningSession[] = [];
  let cursor: string | null = null;
  for (;;) {
    const page: { sessions: ApiMiningSession[]; nextCursor: string | null } = await api.get<{
      sessions: ApiMiningSession[];
      nextCursor: string | null;
    }>(`/api/v1/mining/history?limit=50${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`);
    all.push(...page.sessions);
    cursor = page.nextCursor;
    if (!cursor || all.length >= MAX_EXPORT_ROWS) break;
  }
  return all.slice(0, MAX_EXPORT_ROWS);
}

export function statementFilename(kind: "transactions" | "mining"): string {
  return `louma-${kind}-${new Date().toISOString().slice(0, 10)}.csv`;
}
