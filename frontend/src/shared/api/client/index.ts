/**
 * API client module: transport, shapes, and errors.
 * Import from `@/shared/api` — never deep from this folder.
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
} from "./types";
export { ApiError } from "./types";
export { api, openNotificationStream, messageForError } from "./transport";
