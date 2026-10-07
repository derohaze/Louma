import type { Collection } from "mongodb";
import type { WalletRecord } from "../../shared/types.js";
import { isCanonicalWalletAddressDuplicate } from "./wallet-errors.js";

const BATCH_SIZE = 200;
const MAX_ADDRESS_ATTEMPTS = 3;

export interface WalletAddressMigrationReport {
  planned: number;
  migrated: number;
  changedByConcurrentRun: number;
}

/** Replaces legacy wallet address fields only; ledger and journal history remain untouched. */
export async function migrateWalletAddresses(input: {
  wallets: Collection<WalletRecord>;
  dryRun: boolean;
  generateAddress: () => string;
}): Promise<WalletAddressMigrationReport> {
  const report: WalletAddressMigrationReport = { planned: 0, migrated: 0, changedByConcurrentRun: 0 };
  let lastId: WalletRecord["_id"] | null = null;

  for (;;) {
    const batch = await input.wallets
      .find({ addressVersion: 0, ...(lastId ? { _id: { $gt: lastId } } : {}) })
      .sort({ _id: 1 })
      .limit(BATCH_SIZE)
      .toArray();
    if (batch.length === 0) return report;

    for (const wallet of batch) {
      lastId = wallet._id;
      report.planned += 1;
      if (input.dryRun) continue;

      let migrated = false;
      for (let attempt = 1; attempt <= MAX_ADDRESS_ATTEMPTS; attempt += 1) {
        const address = input.generateAddress();
        try {
          const result = await input.wallets.updateOne(
            { _id: wallet._id, addressVersion: 0, address: wallet.address },
            { $set: { address, addressNormalized: address, addressVersion: 1, updatedAt: new Date() } },
          );
          if (result.modifiedCount === 1) report.migrated += 1;
          else report.changedByConcurrentRun += 1;
          migrated = true;
          break;
        } catch (error) {
          if (!isCanonicalWalletAddressDuplicate(error) || attempt === MAX_ADDRESS_ATTEMPTS) throw error;
        }
      }
      if (!migrated) throw new Error(`Wallet address migration did not finish for wallet ${wallet.publicId}`);
    }
    if (batch.length < BATCH_SIZE) return report;
  }
}
