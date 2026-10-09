import { useState } from "react";
import { useStaff } from "@/shared/lib/staff-store";
import {
  Guard,
  PageHeader,
  DataTable,
  FilterBar,
  SearchInput,
  StatusBadge,
  RoleBadge,
  Mono,
  type Column,
} from "@/shared/components/primitives";
import { AuditTimeline } from "@/shared/components/AuditTimeline";
import type { AuditEntry } from "@/shared/lib/mock-data";

export function AuditLogsPage() {
  return (
    <Guard perm="audit.view">
      <Inner />
    </Guard>
  );
}

function Inner() {
  const { audit } = useStaff();
  const [q, setQ] = useState("");
  const rows = audit.filter(
    (a) =>
      !q ||
      `${a.staff} ${a.action} ${a.target} ${a.reason}`.toLowerCase().includes(q.toLowerCase()),
  );
  const cols: Column<AuditEntry>[] = [
    { key: "time", header: "Time", cell: (a) => <Mono>{a.time}</Mono> },
    { key: "staff", header: "Staff", cell: (a) => <span className="font-medium">{a.staff}</span> },
    { key: "role", header: "Role", cell: (a) => <RoleBadge role={a.role} /> },
    { key: "action", header: "Action", cell: (a) => a.action },
    { key: "target", header: "Target", cell: (a) => <Mono>{a.target}</Mono> },
    {
      key: "reason",
      header: "Reason",
      cell: (a) => <span className="max-w-48 truncate text-muted-foreground">{a.reason}</span>,
    },
    { key: "status", header: "Status", cell: (a) => <StatusBadge status={a.status} /> },
  ];
  return (
    <div>
      <PageHeader
        title="Audit logs"
        subtitle={`${rows.length} entries · every action in this console is recorded here (mock)`}
      />
      <div className="grid gap-4 xl:grid-cols-3">
        <div className="xl:col-span-2">
          <FilterBar>
            <SearchInput
              value={q}
              onChange={setQ}
              placeholder="Search staff, action, target…"
              className="w-full"
            />
          </FilterBar>
          <DataTable columns={cols} rows={rows} rowKey={(a) => a.id} />
        </div>
        <div className="surface h-fit p-5">
          <h3 className="mb-4 text-[15px] font-semibold">Timeline</h3>
          <AuditTimeline entries={rows.slice(0, 8)} />
        </div>
      </div>
    </div>
  );
}
