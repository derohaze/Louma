/**
 * Mining use-cases: start, read state, settle, and list history.
 *
 * Mining is a persisted cycle plus a pure function of the clock — there is no timer, no job, and no
 * in-memory session anywhere in this module. A cycle's reward is always recomputed from its stored
 * rate and window against the server's current time, so the same account sees the same cycle from
 * every device, a process restart loses nothing, and any number of API processes read the same
 * state. Settlement is the only write, and it is a compare-and-set on the cycle plus a balanced
 * ledger transaction, which makes it idempotent under duplicate, concurrent, and replayed requests.
 *
 * One capability per module; this barrel keeps the public surface stable.
 */
export { getMiningState, stateFromRecord, toPublicSession } from "./state.js";
export { startMining, type MiningStartDeviceContext } from "./start.js";
export { settleMining, settleMiningForOwner, settleSession, type MiningSettlementInput } from "./settle.js";
export { listMiningHistory } from "./history.js";
