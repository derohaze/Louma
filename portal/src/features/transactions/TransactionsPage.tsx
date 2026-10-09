import { useState } from "react";
import { useStaff, fmt } from "@/shared/lib/staff-store";
import {
  Guard,
  PageHeader,
  DataTable,
  FilterBar,
  SearchInput,
  Chip,
  StatusBadge,
  Mono,
  type Column,
} from "@/shared/components/primitives";
import type { Transaction } from "@/shared/lib/mock-data";

export function TransactionsPage() {
  return (
    <Guard perm="transactions.view">
      <Inner />
    </Guard>
  );
}

function Inner() {
  const { transactions } = useStaff();
  const [q, setQ] = useState("");
  const [type, setType] = useState("All");
  const rows = transactions.filter((t) => {
    if (type !== "All" && t.type !== type) return false;
    if (q && !`${t.id} ${t.userId} ${t.type}`.toLowerCase().includes(q.toLowerCase())) return false;
    return true;
  });
  const cols: Column<Transaction>[] = [
    { key: "id", header: "ID", cell: (t) => <Mono>{t.id}</Mono> },
    { key: "user", header: "User", cell: (t) => <Mono>{t.userId}</Mono> },
    { key: "type", header: "Type", cell: (t) => <span className="font-medium">{t.type}</span> },
    {
      key: "amount",
      header: "Amount",
      cell: (t) => (
        <span className={`font-mono font-semibold ${t.amount < 0 ? "text-destructive" : ""}`}>
          {fmt.money(t.amount, t.currency)}
        </span>
      ),
    },
    { key: "status", header: "Status", cell: (t) => <StatusBadge status={t.status} /> },
    {
      key: "date",
      header: "Date",
      cell: (t) => <span className="text-muted-foreground">{t.date}</span>,
    },
  ];
  return (
    <div>
      <PageHeader
        title="Transactions"
        subtitle={`${rows.length} ledger entries · read-only mock`}
      />
      <FilterBar>
        <SearchInput
          value={q}
          onChange={setQ}
          placeholder="Search ID, user, type…"
          className="min-w-64 flex-1"
        />
      </FilterBar>
      <div className="mb-4 flex flex-wrap gap-1">
        {["All", "Mining Reward", "Withdrawal", "Deposit", "Adjustment", "Commission"].map((s) => (
          <Chip key={s} active={type === s} onClick={() => setType(s)}>
            {s}
          </Chip>
        ))}
      </div>
      <DataTable columns={cols} rows={rows} rowKey={(t) => t.id} />
    </div>
  );
}
