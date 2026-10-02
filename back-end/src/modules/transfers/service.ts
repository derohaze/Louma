/**
 * Transfers use-cases: preview (quote + approval), create (atomic money movement),
 * and history reads. One capability per module; this barrel keeps the public surface
 * (`previewTransfer`, `createTransfer`, `getTransaction`, `listTransactions`) stable.
 */
export { previewTransfer } from "./preview.js";
export { createTransfer } from "./create.js";
export { getTransaction, listTransactions } from "./queries.js";
