/**
 * Wallet domain: money math, navigation, address book, snapshots, statements.
 */
export type { SavedAddress } from "./address-book";
export {
  loadAddressBook,
  saveAddress,
  removeAddress,
  isSavedAddress,
  shortAddress,
  prefillTransfer,
  consumeTransferPrefill,
  clearTransferPrefill,
  loadLocalNote,
  saveLocalNote,
  displayNote,
} from "./address-book";
export { downloadCsv, transactionsToCsv } from "./statements";
export { miningPayoutsInWindow, type MiningPayout } from "./mining-payouts";
export type { WalletSnapshot } from "./wallet-cache";
export { readWalletSnapshot, writeWalletSnapshot, clearWalletSnapshot } from "./wallet-cache";
export {
  MONEY_SCALE,
  MAX_TRANSFER_MINOR,
  moneyToMinorUnits,
  moneyFromMinorUnits,
  sumMoney,
  moneyChartValue,
  currency,
  transferTax,
  transferNet,
  dateText,
  transactionDateText,
} from "./wallet-format";
export type { NavHref, NavSection } from "./wallet-nav";
export { navSections, navItems, findActiveSection } from "./wallet-nav";
