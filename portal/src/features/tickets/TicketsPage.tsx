import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useStaff } from "@/shared/lib/staff-store";
import {
  Guard,
  PageHeader,
  DataTable,
  FilterBar,
  SearchInput,
  Chip,
  StatusBadge,
  Avatar,
  Mono,
  type Column,
} from "@/shared/components/primitives";
import type { Ticket } from "@/shared/lib/mock-data";

export function TicketsPage() {
  return (
    <Guard perm="tickets.view">
      <Inner />
    </Guard>
  );
}

function Inner() {
  const { tickets, users } = useStaff();
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("All");
  const rows = tickets.filter((t) => {
    if (status !== "All" && t.status !== status) return false;
    if (q && !`${t.id} ${t.subject} ${t.userId}`.toLowerCase().includes(q.toLowerCase()))
      return false;
    return true;
  });
  const cols: Column<Ticket>[] = [
    {
      key: "id",
      header: "Ticket",
      cell: (t) => (
        <div>
          <div className="font-semibold">{t.subject}</div>
          <Mono>
            {t.id} · {t.updated}
          </Mono>
        </div>
      ),
    },
    {
      key: "user",
      header: "User",
      cell: (t) => {
        const u = users.find((x) => x.id === t.userId);
        return (
          <div className="flex items-center gap-2">
            <Avatar name={u?.username ?? "?"} size={28} />
            <Mono>{t.userId}</Mono>
          </div>
        );
      },
    },
    { key: "status", header: "Status", cell: (t) => <StatusBadge status={t.status} /> },
    { key: "prio", header: "Priority", cell: (t) => <StatusBadge status={t.priority} /> },
    {
      key: "assigned",
      header: "Assigned",
      cell: (t) => <span className="text-muted-foreground">{t.assigned ?? "Unassigned"}</span>,
    },
    {
      key: "open",
      header: "",
      cell: (t) => (
        <Link
          to="/tickets/$id"
          params={{ id: t.id }}
          onClick={(e) => e.stopPropagation()}
          className="rounded-lg bg-primary-soft px-3 py-1.5 text-xs font-semibold text-primary hover:bg-primary hover:text-primary-foreground"
        >
          Open
        </Link>
      ),
    },
  ];
  return (
    <div>
      <PageHeader
        title="Support tickets"
        subtitle={`${rows.length} tickets · reply, notes, escalate`}
      />
      <FilterBar>
        <SearchInput
          value={q}
          onChange={setQ}
          placeholder="Search ticket, subject, user…"
          className="min-w-64 flex-1"
        />
      </FilterBar>
      <div className="mb-4 flex flex-wrap gap-1">
        {["All", "New", "Open", "Waiting", "Escalated", "Resolved", "Closed"].map((s) => (
          <Chip key={s} active={status === s} onClick={() => setStatus(s)}>
            {s}
          </Chip>
        ))}
      </div>
      <DataTable columns={cols} rows={rows} rowKey={(t) => t.id} />
    </div>
  );
}
