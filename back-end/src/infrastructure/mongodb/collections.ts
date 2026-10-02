import type { Collection, Db } from "mongodb";
import type {
  FinancialControlsRecord,
  LedgerAccountRecord,
  LedgerEntryRecord,
  MiningDeviceLeaseRecord,
  MiningDeviceNonceRecord,
  MiningDeviceObservationRecord,
  MiningDeviceQuotaRecord,
  MiningDeviceRecord,
  MiningSessionRecord,
  MiningSettlementRecord,
  NotificationRecord,
  SecurityEventRecord,
  SessionRecord,
  TransactionRecord,
  TransferAuthorizationRecord,
  TransferPasswordCredentialRecord,
  TwoFactorCredentialRecord,
  TwoFactorUseRecord,
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
  /** Server-issued transfer approvals: the challenge a transfer consumes. */
  transferAuthorizations: Collection<TransferAuthorizationRecord>;
  /** Consumed authenticator steps, one document per accepted step. */
  twoFactorUses: Collection<TwoFactorUseRecord>;
  /** The single operator-control row for the financial surfaces. */
  financialControls: Collection<FinancialControlsRecord>;
  notifications: Collection<NotificationRecord>;
  miningSessions: Collection<MiningSessionRecord>;
  /**
   * @deprecated LEGACY (see ADR-003). No longer written by any code path: the journal header in
   * `transactions` is the authoritative mining record. Kept only so the one-way migration can
   * copy legacy rows into the journal; remove together with the collection once the migration is
   * verified on every deployment (see docs/migrations.md).
   */
  miningSettlements: Collection<MiningSettlementRecord>;
  miningSettings: Collection<import("../../modules/mining/settings.js").MiningSettingRecord>;
  miningPoolMembers: Collection<import("../../modules/mining/pools.js").MiningPoolMembershipRecord>;
  miningDevices: Collection<MiningDeviceRecord>;
  miningDeviceLeases: Collection<MiningDeviceLeaseRecord>;
  miningDeviceNonces: Collection<MiningDeviceNonceRecord>;
  miningDeviceObservations: Collection<MiningDeviceObservationRecord>;
  miningDeviceQuotas: Collection<MiningDeviceQuotaRecord>;
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
    transferAuthorizations: db.collection<TransferAuthorizationRecord>("transfer_authorizations"),
    twoFactorUses: db.collection<TwoFactorUseRecord>("two_factor_uses"),
    financialControls: db.collection<FinancialControlsRecord>("financial_controls"),
    notifications: db.collection<NotificationRecord>("notifications"),
    miningSessions: db.collection<MiningSessionRecord>("mining_sessions"),
    miningSettlements: db.collection<MiningSettlementRecord>("mining_settlements"),
    miningSettings: db.collection<import("../../modules/mining/settings.js").MiningSettingRecord>("mining_settings"),
    miningPoolMembers: db.collection<import("../../modules/mining/pools.js").MiningPoolMembershipRecord>("mining_pool_members"),
    miningDevices: db.collection<MiningDeviceRecord>("mining_devices"),
    miningDeviceLeases: db.collection<MiningDeviceLeaseRecord>("mining_device_leases"),
    miningDeviceNonces: db.collection<MiningDeviceNonceRecord>("mining_device_nonces"),
    miningDeviceObservations: db.collection<MiningDeviceObservationRecord>("mining_device_observations"),
    miningDeviceQuotas: db.collection<MiningDeviceQuotaRecord>("mining_device_quotas"),
  };
}
