import type { ClientSession, Document } from "mongodb";
import type { Collections } from "./collections.js";
import { assertBalanced } from "../../modules/ledger/money.js";
import type {
  MerchantPaymentTransactionRecord,
  MerchantRefundTransactionRecord,
  MiningTransactionRecord,
  TransferTransactionRecord,
} from "../../shared/types.js";

/**
 * Journal and ledger-entry data access: the only layer that writes financial headers and lines.
 *
 * The invariant lives here, not in each service: a journal header and its ledger entries are
 * inserted together, the lines are asserted balanced before anything is written, and every
 * transfer-scoped read filters `type: "transfer"` so mining issuance headers (which share the
 * collection) can never leak into the transfer view. Services keep their own orchestration —
 * guards, ordering, retries — but they do not hand-roll header/entry inserts.
 *
 * Balance mutations stay in the services: each flow's conditional update (sufficient-funds
 * debit, ceiling-checked credit, treasury debit) carries flow-specific failure semantics that a
 * generic helper would obscure. What is centralized is the pairing, the balance assertion, and
 * the idempotency lookups.
 */

export interface JournalLine {
  ledgerAccountId: string;
  walletId: string | null;
  side: "debit" | "credit";
  amountMinor: number;
  correlationId: string;
  createdAt: Date;
}

export interface JournalWrite {
  header: Omit<TransferTransactionRecord, "_id"> | Omit<MiningTransactionRecord, "_id"> | Omit<MerchantPaymentTransactionRecord, "_id"> | Omit<MerchantRefundTransactionRecord, "_id">;
  lines: JournalLine[];
  linePublicIds: string[];
}

/**
 * Inserts one journal header with its ledger lines inside the caller's transaction. Throws
 * before writing anything when the lines are not balanced; duplicate-key errors bubble to the
 * caller, which converges on the idempotency record (the insert race means someone else posted
 * this exact header first).
 */
export async function postBalancedJournal(
  collections: Collections,
  write: JournalWrite,
  session: ClientSession,
): Promise<void> {
  assertBalanced(write.lines);
  if (write.lines.length !== write.linePublicIds.length) {
    throw new Error("Journal lines and line identifiers must pair one-to-one");
  }
  // The driver attaches `_id` to its input; keep an immutable intent reusable across retries.
  await collections.transactions.insertOne({ ...write.header } as Document as never, { session });
  await collections.ledgerEntries.insertMany(
    write.lines.map((line, index) => ({
      publicId: write.linePublicIds[index],
      transactionId: write.header.publicId,
      lineNumber: index + 1,
      walletId: line.walletId,
      ledgerAccountId: line.ledgerAccountId,
      side: line.side,
      amountMinor: line.amountMinor,
      currency: "LMA",
      correlationId: line.correlationId,
      createdAt: line.createdAt,
    })) as never,
    { session, ordered: true },
  );
}

