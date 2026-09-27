/**
 * The mining dashboard runs on simulated farm data until the mining API exists.
 * The fields mirror what the mining endpoints exposed in the previous wallet
 * (device list, hashrate, power draw, temperature, rewards) so replacing the
 * reads below with real requests later is mechanical.
 *
 * Mining rewards are deliberately kept out of the wallet balance: the wallet
 * store owns real balance mutations, and nothing here should look like money
 * that was actually credited.
 */
export type MiningDeviceStatus = "mining" | "idle" | "offline";

export interface MiningDevice {
  id: string;
  name: string;
  model: string;
  status: MiningDeviceStatus;
  hashrate: number;
  power: number;
  temperature: number;
  earnedToday: number;
}

export interface MiningSnapshot {
  active: boolean;
  boosted: boolean;
  startedAt: string | null;
  devices: MiningDevice[];
  totalHashrate: number;
  powerDraw: number;
  devicesOnline: number;
  todayEarnings: number;
  lifetimeEarnings: number;
}

/** Normal-clock hashrate for a four-module rig. */
const BASE_RATE = 940;
const BOOST_FACTOR = 1.35;

const farm = {
  active: false,
  boosted: false,
  startedAt: null as string | null,
  lifetimeEarnings: 18420.35,
};

const devices: MiningDevice[] = [
  {
    id: "rig-a1",
    name: "Rig A1",
    model: "CRN-X4 · 4 modules",
    status: "mining",
    hashrate: BASE_RATE,
    power: 420,
    temperature: 62,
    earnedToday: 96.4,
  },
  {
    id: "rig-b2",
    name: "Rig B2",
    model: "CRN-X4 · 4 modules",
    status: "mining",
    hashrate: BASE_RATE,
    power: 405,
    temperature: 65,
    earnedToday: 91.2,
  },
  {
    id: "node-c3",
    name: "Node C3",
    model: "CRN-Mini · 2 modules",
    status: "idle",
    hashrate: 0,
    power: 18,
    temperature: 34,
    earnedToday: 0,
  },
  {
    id: "node-d4",
    name: "Node D4",
    model: "CRN-Mini · 2 modules",
    status: "offline",
    hashrate: 0,
    power: 0,
    temperature: 0,
    earnedToday: 0,
  },
];

const applyClock = (): void => {
  const factor = farm.boosted ? BOOST_FACTOR : 1;
  for (const device of devices) {
    if (device.status === "mining") {
      const derate = device.id === "rig-b2" ? 0.94 : 1;
      device.hashrate = Number((BASE_RATE * factor * derate).toFixed(1));
      device.power = Math.round(420 * factor * derate);
      device.temperature = Math.min(device.temperature + (farm.boosted ? 4 : 0), 78);
    } else if (device.status === "idle") {
      device.hashrate = 0;
      device.power = farm.boosted ? 22 : 18;
      device.temperature = farm.boosted ? 37 : 34;
    } else {
      device.hashrate = 0;
      device.power = 0;
      device.temperature = 0;
    }
  }
  farm.active = devices.some((device) => device.status === "mining");
  if (!farm.active) {
    farm.boosted = false;
    farm.startedAt = null;
  }
};

export const readMining = (): MiningSnapshot => {
  applyClock();
  const todayEarnings = devices.reduce((sum, device) => sum + device.earnedToday, 0);
  return {
    active: farm.active,
    boosted: farm.boosted,
    startedAt: farm.startedAt,
    devices: devices.map((device) => ({ ...device })),
    totalHashrate: devices.reduce((sum, device) => sum + device.hashrate, 0),
    powerDraw: devices.reduce((sum, device) => sum + device.power, 0),
    devicesOnline: devices.filter((device) => device.status !== "offline").length,
    todayEarnings,
    lifetimeEarnings: farm.lifetimeEarnings + todayEarnings,
  };
};

export const startMining = (boosted: boolean): void => {
  farm.boosted = boosted;
  farm.startedAt = new Date().toISOString();
  for (const device of devices) {
    if (device.status === "idle") device.status = "mining";
  }
  applyClock();
};

export const stopMining = (): void => {
  for (const device of devices) {
    if (device.status === "mining") device.status = "idle";
  }
  applyClock();
};

export const setBoosted = (boosted: boolean): void => {
  farm.boosted = boosted;
  if (boosted && !farm.startedAt) farm.startedAt = new Date().toISOString();
  applyClock();
};

export const setDeviceStatus = (id: string, status: MiningDeviceStatus): void => {
  const device = devices.find((item) => item.id === id);
  if (!device || device.status === "offline") return;
  device.status = status;
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
  const peak = snapshot.totalHashrate || BASE_RATE;
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
