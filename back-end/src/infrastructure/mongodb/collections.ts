import type { Collection, Db } from "mongodb";
import type {
  LedgerAccountRecord,
  LedgerEntryRecord,
  NotificationRecord,
  SecurityEventRecord,
  SessionRecord,
  TransactionRecord,
  TransferPasswordCredentialRecord,
  TwoFactorCredentialRecord,
  UserRecord,
  WalletRecord,
} from "../../shared/types.js";

export interface Collections {
  users: Collection<UserRecord>;
  wallets: Collection<WalletRecord>;
  ledgerAccounts: Collection<LedgerAccountRecord>;
  ledgerEntries: Collection<LedgerEntryRecord>;
  transactions: Collection<TransactionRecord>;
  sessions: Collection<SessionRecord>;
  securityEvents: Collection<SecurityEventRecord>;
  twoFactorCredentials: Collection<TwoFactorCredentialRecord>;
  transferPasswordCredentials: Collection<TransferPasswordCredentialRecord>;
  notifications: Collection<NotificationRecord>;
}

export function getCollections(db: Db): Collections {
  return {
    users: db.collection<UserRecord>("users"),
    wallets: db.collection<WalletRecord>("wallets"),
    ledgerAccounts: db.collection<LedgerAccountRecord>("ledger_accounts"),
    ledgerEntries: db.collection<LedgerEntryRecord>("ledger_entries"),
    transactions: db.collection<TransactionRecord>("transactions"),
    sessions: db.collection<SessionRecord>("sessions"),
    securityEvents: db.collection<SecurityEventRecord>("security_events"),
    twoFactorCredentials: db.collection<TwoFactorCredentialRecord>("two_factor_credentials"),
    transferPasswordCredentials: db.collection<TransferPasswordCredentialRecord>("transfer_password_credentials"),
    notifications: db.collection<NotificationRecord>("notifications"),
  };
}
