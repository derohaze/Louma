import { useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  Activity02Icon,
  ArrowReloadHorizontalIcon,
  BoltIcon,
  CheckmarkCircle01Icon,
  ChartIncreaseIcon,
  Clock01Icon,
  CpuIcon,
  DashboardSpeed01Icon,
} from "@hugeicons/core-free-icons";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useWallet } from "@/hooks/use-wallet";
import { currency } from "@/lib/wallet-format";
import {
  hashrateSeries,
  readMining,
  setBoosted,
  setDeviceStatus,
  startMining,
  stopMining,
  type MiningDeviceStatus,
} from "@/lib/demo-mining";
import { Icon, PageHeader } from "./wallet-shell";

const hashrateText = (value: number) =>
  `${new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(value)} H/s`;

const statusStyles: Record<MiningDeviceStatus, string> = {
  mining: "border-success/40 bg-success/10 text-[#1F7A5A]",
  idle: "border-border bg-secondary text-[#58585E]",
  offline: "border-border bg-secondary/60 text-muted-foreground",
};

const statusLabel: Record<MiningDeviceStatus, string> = {
  mining: "Mining",
  idle: "Idle",
  offline: "Offline",
};

export function MiningContent() {
  const { wallet } = useWallet();
  const [snapshot, setSnapshot] = useState(readMining);
  const [range, setRange] = useState<"24h" | "7d">("24h");
  const isPremium = wallet?.is_premium ?? false;
  const series = useMemo(() => hashrateSeries(snapshot, range), [snapshot, range]);
  const refresh = () => setSnapshot(readMining());

  const toggleMining = () => {
    if (snapshot.active) stopMining();
    else startMining(snapshot.boosted && isPremium);
    refresh();
  };

  const toggleBoost = (value: boolean) => {
    if (value && !isPremium) return;
    setBoosted(value);
    refresh();
  };

  const toggleDevice = (id: string, value: boolean) => {
    setDeviceStatus(id, value ? "mining" : "idle");
    refresh();
  };

  return (
    <>
      <PageHeader
        title="Mining"
        subtitle="Track your farm, hashrate, and mining rewards."
        action={
          <Button onClick={toggleMining}>
            <Icon icon={CpuIcon} size={17} />
            {snapshot.active ? "Stop mining" : "Start mining"}
          </Button>
        }
      />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[
          {
            label: "Total hashrate",
            value: hashrateText(snapshot.totalHashrate),
            hint: snapshot.boosted ? "Boosted clock" : "Normal clock",
            icon: DashboardSpeed01Icon,
          },
          {
            label: "Power draw",
            value: `${new Intl.NumberFormat("en-US").format(snapshot.powerDraw)} W`,
            hint: snapshot.active ? "Farm running" : "Farm stopped",
            icon: BoltIcon,
          },
          {
            label: "Devices online",
            value: `${snapshot.devicesOnline} / ${snapshot.devices.length}`,
            hint: `${snapshot.devices.filter((d) => d.status === "mining").length} currently mining`,
            icon: CpuIcon,
          },
          {
            label: "Earned today",
            value: currency(snapshot.todayEarnings),
            hint: `Lifetime ${currency(snapshot.lifetimeEarnings)}`,
            icon: ChartIncreaseIcon,
          },
        ].map((card, index) => (
          <section
            key={card.label}
            className="min-h-28 rounded-[22px] border bg-card p-4 shadow-sm animate-fade-in"
            style={{ animationDelay: `${index * 70}ms`, animationFillMode: "both" }}
          >
            <div className="flex items-center gap-2 text-sm font-semibold">
              <Icon icon={card.icon} size={18} className="text-muted-foreground" />
              {card.label}
            </div>
            <strong className="mt-4 block font-display text-2xl">{card.value}</strong>
            <p className="mt-1 text-xs text-muted-foreground">{card.hint}</p>
          </section>
        ))}
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-[1.6fr_1fr]">
        <section className="rounded-[22px] border bg-card shadow-sm">
          <div className="flex flex-wrap items-center gap-3 border-b px-5 py-4">
            <div className="min-w-0 flex-1">
              <h2 className="font-display text-base font-semibold">Hashrate</h2>
              <p className="mt-1 text-xs text-muted-foreground">
                {snapshot.active ? "Live from your farm" : "Farm stopped — showing last session"}
              </p>
            </div>
            <div className="flex gap-1 rounded-full border bg-secondary/60 p-1">
              {(["24h", "7d"] as const).map((item) => (
                <Button
                  key={item}
                  variant="ghost"
                  onClick={() => setRange(item)}
                  className={`h-8 rounded-full px-4 text-xs font-semibold ${
                    range === item ? "bg-card text-foreground shadow-sm" : "text-muted-foreground"
                  }`}
                >
                  {item}
                </Button>
              ))}
            </div>
          </div>
          <div className="h-64 p-5">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={series}>
                <defs>
                  <linearGradient id="hashrateFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--primary)" stopOpacity={0.3} />
                    <stop offset="100%" stopColor="var(--primary)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid vertical={false} stroke="var(--border)" />
                <XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={12} />
                <YAxis tickLine={false} axisLine={false} fontSize={12} width={46} />
                <Tooltip formatter={(value) => hashrateText(Number(value))} />
                <Area
                  type="monotone"
                  dataKey="hashrate"
                  stroke="var(--primary)"
                  fill="url(#hashrateFill)"
                  strokeWidth={2}
                  isAnimationActive
                  animationDuration={900}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </section>

        <section className="rounded-[22px] border bg-card shadow-sm">
          <div className="flex items-center gap-2 border-b px-5 py-4">
            <span
              className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold ${
                snapshot.active
                  ? "border-success/40 bg-success/10 text-[#1F7A5A]"
                  : "border-border bg-secondary text-[#58585E]"
              }`}
            >
              <Icon icon={snapshot.active ? CheckmarkCircle01Icon : Clock01Icon} size={14} />
              {snapshot.active ? "Running" : "Stopped"}
            </span>
            <h2 className="ms-auto font-display text-base font-semibold">Controls</h2>
          </div>
          <div className="space-y-5 p-5">
            <label className="flex items-start gap-3">
              <Switch
                checked={snapshot.boosted}
                disabled={!isPremium}
                onCheckedChange={toggleBoost}
                aria-label="Boosted mining"
              />
              <span className="text-sm">
                <strong className="block font-semibold">Boosted mining</strong>
                <span className="text-xs text-muted-foreground">
                  {isPremium
                    ? "Runs the farm at a higher clock. Expect warmer devices and more power draw."
                    : "Premium wallets only. Your farm runs at the standard clock."}
                </span>
              </span>
            </label>
            <div className="rounded-xl bg-secondary p-4 text-sm">
              <p className="flex items-center gap-2 font-semibold">
                <Icon icon={ArrowReloadHorizontalIcon} size={16} />
                Session
              </p>
              <p className="mt-2 text-xs text-muted-foreground">
                {snapshot.startedAt
                  ? `Started ${new Date(snapshot.startedAt).toLocaleString()}`
                  : "No session running."}
              </p>
              <p className="mt-2 text-xs text-muted-foreground">
                Rewards are credited by the mining service once a session settles. This screen shows
                the current estimate only.
              </p>
            </div>
          </div>
        </section>
      </div>

      <section className="mt-4 overflow-hidden rounded-[22px] border bg-card shadow-sm">
        <div className="border-b px-5 py-4">
          <h2 className="font-display text-base font-semibold">Devices</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Start or idle any device remotely. Offline devices cannot be controlled.
          </p>
        </div>
        {snapshot.devices.map((device) => (
          <div
            key={device.id}
            className="flex flex-wrap items-center gap-4 border-b px-5 py-4 last:border-0"
          >
            <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-secondary">
              <Icon
                icon={device.status === "offline" ? Clock01Icon : Activity02Icon}
                size={18}
                className={device.status === "mining" ? "text-primary" : "text-muted-foreground"}
              />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold">{device.name}</p>
              <p className="text-xs text-muted-foreground">{device.model}</p>
            </div>
            <div className="hidden w-28 text-sm sm:block">
              <p className="text-xs text-muted-foreground">Hashrate</p>
              <p className="mt-1 font-semibold">{hashrateText(device.hashrate)}</p>
            </div>
            <div className="hidden w-20 text-sm md:block">
              <p className="text-xs text-muted-foreground">Power</p>
              <p className="mt-1 font-semibold">{device.power} W</p>
            </div>
            <div className="hidden w-20 text-sm lg:block">
              <p className="text-xs text-muted-foreground">Temp</p>
              <p className="mt-1 font-semibold">
                {device.status === "offline" ? "—" : `${device.temperature}°C`}
              </p>
            </div>
            <span
              className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold ${statusStyles[device.status]}`}
            >
              {statusLabel[device.status]}
            </span>
            <span className="w-16 text-end text-sm font-semibold">
              {device.earnedToday ? currency(device.earnedToday) : "—"}
            </span>
            <Switch
              checked={device.status === "mining"}
              disabled={device.status === "offline"}
              onCheckedChange={(checked) => toggleDevice(device.id, checked)}
              aria-label={`${device.status === "mining" ? "Idle" : "Start"} ${device.name}`}
            />
          </div>
        ))}
      </section>
    </>
  );
}
