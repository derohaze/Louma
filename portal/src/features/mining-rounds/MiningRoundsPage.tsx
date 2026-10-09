import { useStaff } from "@/shared/lib/staff-store";
import { ROUNDS, type MiningRound } from "@/shared/lib/mock-data";
import {
  Guard,
  PageHeader,
  DataTable,
  StatusBadge,
  Mono,
  MetricCard,
  type Column,
} from "@/shared/components/primitives";
import { Timer, Pickaxe, Gauge } from "lucide-react";

export function MiningRoundsPage() {
  return (
    <Guard perm="mining.rounds">
      <Inner />
    </Guard>
  );
}

function Inner() {
  const { rooms } = useStaff();
  const cols: Column<MiningRound>[] = [
    { key: "id", header: "Round", cell: (r) => <span className="font-semibold">{r.id}</span> },
    { key: "room", header: "Room", cell: (r) => r.room },
    { key: "miners", header: "Miners", cell: (r) => <Mono>{r.miners}</Mono> },
    {
      key: "reward",
      header: "Reward",
      cell: (r) => <span className="font-mono font-medium">{r.reward} LMP</span>,
    },
    { key: "diff", header: "Difficulty", cell: (r) => <Mono>{r.difficulty.toFixed(1)}</Mono> },
    { key: "dur", header: "Duration", cell: (r) => <Mono>{r.duration}</Mono> },
    { key: "status", header: "Status", cell: (r) => <StatusBadge status={r.status} /> },
    {
      key: "started",
      header: "Started",
      cell: (r) => <span className="text-muted-foreground">{r.started}</span>,
    },
  ];
  const running = ROUNDS.filter((r) => r.status === "Running").length;
  return (
    <div>
      <PageHeader title="Mining rounds" subtitle="Live and historical rounds · Manager+" />
      <div className="mb-4 grid gap-4 sm:grid-cols-3">
        <MetricCard
          label="Running"
          value={running}
          icon={<Timer className="size-3.5" />}
          tone="primary"
        />
        <MetricCard
          label="Active rooms"
          value={rooms.filter((r) => r.status === "Open").length}
          icon={<Pickaxe className="size-3.5" />}
          tone="success"
        />
        <MetricCard
          label="Avg difficulty"
          value="4.4"
          icon={<Gauge className="size-3.5" />}
          tone="info"
        />
      </div>
      <DataTable columns={cols} rows={ROUNDS} rowKey={(r) => r.id} />
    </div>
  );
}
