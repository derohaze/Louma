/**
 * Mining use-cases: start, stop/resume, read state, settle, and list history.
 *
 * Mining is persisted segments plus a pure function of the clock — there is no timer, no job, and
 * no in-memory session anywhere in this module. A segment's reward is always recomputed from its
 * stored rate and window against the server's current time, so the same account sees the same
 * segment from every device, a process restart loses nothing, and any number of API processes read
 * the same state. Start/stop/settle are compare-and-set writes (segment + balanced ledger +
 * device-lease release in one transaction), idempotent under duplicate, concurrent, and replayed
 * requests. The 10h/24h account and device quotas are server-derived sums of actual-mining time;
 * stop never refunds and resume is a new segment on the same anchors.
 *
 * One capability per module; this barrel keeps the public surface stable.
 */
export { getMiningState, stateFromRecord, toPublicSession, quotaFromSessions, loadAccountWindowSessions } from "./state.js";
export { startMining, type MiningStartDeviceContext } from "./start.js";
export { stopMining } from "./stop.js";
export { settleMining, settleMiningForOwner, settleSession, type MiningSettlementInput } from "./settle.js";
export { listMiningHistory } from "./history.js";
export * from "./quota.js";
