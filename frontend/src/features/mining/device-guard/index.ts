/**
 * Device Guard public surface. Mining feature code imports from
 * `@/features/mining/device-guard` and never from the modules below directly.
 */
export type { DeviceEvidencePayload } from "./evidence-types";
export { DEVICE_IN_USE_MESSAGE } from "./evidence-types";
export {
  collectDeviceEvidence,
  DEVICE_EVIDENCE_MISSING_MESSAGE,
  messageForMiningError,
  POOL_REQUIRED_MESSAGE,
  startMiningWithGuard,
} from "./device-proof";
