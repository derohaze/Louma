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
  BoltIcon,
  ChartIncreaseIcon,
  CpuIcon,
  DashboardSpeed01Icon,
} from "@hugeicons/core-free-icons";
import { Button } from "@/components/ui/button";
import { currency } from "@/lib/wallet-format";
import { hashrateSeries, readMining, startMining, stopMining } from "@/lib/demo-mining";
import { Icon, PageHeader } from "./wallet-shell";

const hashrateText = (value: number) =>
  `${new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(value)} H/s`;

export function MiningContent() {
  const [snapshot, setSnapshot] = useState(readMining);
  const [range, setRange] = useState<"24h" | "7d">("24h");
  const series = useMemo(() => hashrateSeries(snapshot, range), [snapshot, range]);
  const refresh = () => setSnapshot(readMining());

  const toggleMining = () => {
    if (snapshot.active) stopMining();
    else startMining();
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
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {[
          {
            label: "Total hashrate",
            value: hashrateText(snapshot.totalHashrate),
            hint: snapshot.active ? "Farm running" : "Farm stopped",
            icon: DashboardSpeed01Icon,
          },
          {
            label: "Power draw",
            value: `${new Intl.NumberFormat("en-US").format(snapshot.powerDraw)} W`,
            hint: snapshot.active ? "Farm running" : "Farm stopped",
            icon: BoltIcon,
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

      <section className="mt-4 rounded-[22px] border bg-card shadow-sm">
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
    </>
  );
}
