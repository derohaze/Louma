/**
 * Public surface of the shared API layer. Feature code imports from `@/shared/api` and never
 * from the modules below directly — the split underneath can change without touching callers.
 */
export type {
  ApiUser,
  ApiWallet,
  ApiMiningSession,
  ApiMiningState,
  ApiMiningPool,
  ApiMiningPoolsState,
  ApiTransaction,
  ApiTransferPreview,
  ApiSecurityOverview,
  ApiSession,
  ApiNotification,
} from "./client/types";
export { ApiError } from "./client/types";
export { clearAccessToken } from "./session/session";
export { clearSessionHint } from "./session/session-hint";
export { api, openNotificationStream, messageForError } from "./client/transport";
export { login, register, completeTwoFactor, logout } from "./auth/auth";
