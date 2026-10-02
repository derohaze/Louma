/**
 * Platform domain: framework-agnostic plumbing — validation, server state,
 * errors, notifications, and document head helpers.
 */
export { consumeLastCapturedError } from "./error-capture";
export { renderErrorPage } from "./error-page";
export { reportLovableError } from "./lovable-error-reporting";
export {
  startNotificationStream,
  stopNotificationStream,
  subscribeToNotificationChanges,
} from "./notification-stream";
export { pageHead } from "./page-head";
export type { TransactionPage, NotificationPage, MiningHistoryPage, AccountProfile } from "./server-state";
export {
  hasBrowserSession,
  serverStateKeys,
  serverStateFreshness,
  accountFetchers,
  shouldRetryRequest,
  refetchAccount,
  hydrateAccountCache,
  resetSessionCache,
  clearAccountCache,
} from "./server-state";
export { cn } from "./utils";
export {
  LIMITS,
  sanitizeText,
  isTransferTarget,
  normalizeTransferTarget,
  isOneTimeCode,
  oneTimeCodeDigits,
  parseAmount,
  passwordRules,
  newPasswordError,
} from "./validation";
