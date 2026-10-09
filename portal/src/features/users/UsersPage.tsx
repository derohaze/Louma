import { useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/shared/ui/select";
import type { User } from "@/shared/lib/mock-data";

export function UsersPage() {
  return (
    <Guard perm="users.view">
      <UsersInner />
    </Guard>
  );
}

function UsersInner() {
  const { users, can } = useStaff();
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("All");
  const [mining, setMining] = useState("All");
  const showBalance = can("wallet.viewBalance");

  const rows = users.filter((u) => {
    const hay = `${u.id} ${u.username} ${u.email} ${u.wallet}`.toLowerCase();
    if (q && !hay.includes(q.toLowerCase())) return false;
    if (status !== "All" && u.status !== status) return false;
    if (mining !== "All" && u.miningStatus !== mining) return false;
    return true;
  });

  const cols: Column<User>[] = [
    {
      key: "user",
      header: "User",
      cell: (u) => (
        <div className="flex items-center gap-2.5">
          <Avatar name={u.username} />
          <div>
            <div className="font-semibold">{u.username}</div>
            <Mono>{u.id}</Mono>
          </div>
        </div>
      ),
    },
    { key: "email", header: "Email", cell: (u) => <Mono>{u.email}</Mono> },
    { key: "status", header: "Status", cell: (u) => <StatusBadge status={u.status} /> },
    ...(showBalance
      ? [
          {
            key: "balance",
            header: "Balance",
            cell: (u: User) => (
              <span className="font-mono font-medium">{u.balance.toLocaleString()} LMP</span>
            ),
          } as Column<User>,
        ]
      : []),
    {
      key: "mining",
      header: "Mining",
      cell: (u) => (
        <div className="flex items-center gap-2">
          <StatusBadge status={u.miningStatus} />
          <Mono>{u.miningSpeed} MH/s</Mono>
        </div>
      ),
    },
    {
      key: "active",
      header: "Last active",
      cell: (u) => <span className="text-muted-foreground">{u.lastActive}</span>,
    },
    {
      key: "actions",
      header: "Actions",
      cell: (u) => (
        <Link
          to="/users/$id"
          params={{ id: u.id }}
          className="rounded-lg bg-primary-soft px-3 py-1.5 text-xs font-semibold text-primary transition hover:bg-primary hover:text-primary-foreground"
        >
          Open
        </Link>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Users"
        subtitle={`${rows.length} accounts · search by ID, username, email or wallet`}
      />
      <FilterBar>
        <SearchInput
          value={q}
          onChange={setQ}
          placeholder="Search ID, username, email, wallet…"
          className="min-w-64 flex-1"
        />
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="h-10 w-40 rounded-xl">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {["All", "Active", "Suspended", "Frozen", "Banned"].map((s) => (
              <SelectItem key={s} value={s}>
                {s === "All" ? "All statuses" : s}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={mining} onValueChange={setMining}>
          <SelectTrigger className="h-10 w-40 rounded-xl">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {["All", "Mining", "Idle", "Stuck", "Offline"].map((s) => (
              <SelectItem key={s} value={s}>
                {s === "All" ? "All mining" : s}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </FilterBar>
      <div className="mb-4 flex gap-1">
        {(["All", "Active", "Suspended", "Frozen", "Banned"] as const).map((s) => (
          <Chip key={s} active={status === s} onClick={() => setStatus(s)}>
            {s}
          </Chip>
        ))}
      </div>
      <DataTable
        columns={cols}
        rows={rows}
        rowKey={(u) => u.id}
        onRowClick={(u) => navigate({ to: "/users/$id", params: { id: u.id } })}
        empty="No users match these filters"
      />
    </div>
  );
}
