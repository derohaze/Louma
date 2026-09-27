/**
 * The mining dashboard runs on simulated farm data until the mining API exists. The snapshot mirrors
 * what the mining endpoints exposed in the previous wallet (hashrate, power draw, rewards) so
 * replacing the reads below with real requests later is mechanical.
 *
 * Mining rewards are deliberately kept out of the wallet balance: the wallet store owns real balance
 * mutations, and nothing here should look like money that was actually credited.
 */
export interface MiningSnapshot {
  active: boolean;
  startedAt: string | null;
  totalHashrate: number;
  powerDraw: number;
  todayEarnings: number;
  lifetimeEarnings: number;
}

/** Farm totals when running. Stopping drops hashrate to zero. */
const BASE_HASH_RATE = 1823.6;
const RUNNING_POWER = 815;
const IDLE_POWER = 36;
const TODAY_EARNINGS = 187.6;

const farm = {
  active: true,
  startedAt: null as string | null,
  hashrate: BASE_HASH_RATE,
  power: RUNNING_POWER,
  todayEarnings: TODAY_EARNINGS,
  lifetimeEarnings: 18420.35,
};

const applyClock = (): void => {
  // A stopped farm cannot hold a session, so it resets before the clock is read.
  if (!farm.active) {
    farm.startedAt = null;
  }
  farm.hashrate = farm.active ? BASE_HASH_RATE : 0;
  farm.power = farm.active ? RUNNING_POWER : IDLE_POWER;
};

export const readMining = (): MiningSnapshot => {
  applyClock();
  return {
    active: farm.active,
    startedAt: farm.startedAt,
    totalHashrate: farm.hashrate,
    powerDraw: farm.power,
    todayEarnings: farm.todayEarnings,
    lifetimeEarnings: farm.lifetimeEarnings + farm.todayEarnings,
  };
};

export const startMining = (): void => {
  farm.active = true;
  farm.startedAt = new Date().toISOString();
  applyClock();
};

export const stopMining = (): void => {
  farm.active = false;
  applyClock();
};

/**
 * Deterministic hashrate history: a warm-up curve, a plateau, and a dip for the
 * nightly maintenance window. Generated from the current total so the chart
 * follows the farm state without random flicker between renders.
 */
const dayLabels = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

export const hashrateSeries = (
  snapshot: MiningSnapshot,
  range: "24h" | "7d",
): { label: string; hashrate: number }[] => {
  const points = range === "24h" ? 24 : 7;
  const peak = snapshot.totalHashrate || BASE_HASH_RATE;
  return Array.from({ length: points }, (_, index) => {
    const progress = index / (points - 1);
    const warmup = 0.78 + 0.22 * Math.sin(progress * Math.PI * 1.6);
    const maintenance = progress > 0.62 && progress < 0.7 ? 0.55 : 1;
    const label =
      range === "24h"
        ? `${String((18 + index) % 24).padStart(2, "0")}:00`
        : (dayLabels[index] ?? "—");
    return { label, hashrate: Number((peak * warmup * maintenance).toFixed(1)) };
  });
};
