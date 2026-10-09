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
  Avatar,
  Mono,
  Panel,
  KV,
  type Column,
} from "@/shared/components/primitives";
import { Button } from "@/shared/ui/button";
import { ConfirmationModal } from "@/shared/components/ConfirmationModal";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/shared/ui/sheet";
import type { Withdrawal } from "@/shared/lib/mock-data";

export function WithdrawalsPage() {
  return (
    <Guard perm="withdrawals.view">
      <Inner />
    </Guard>
  );
}

function Inner() {
  const { withdrawals, updateWithdrawal, users, can, act } = useStaff();
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("All");
  const [sel, setSel] = useState<Withdrawal | null>(null);
  const [confirm, setConfirm] = useState<{
    title: string;
    label: string;
    run: (r: string) => void;
  } | null>(null);
  const decide = can("withdrawals.decide");

  const rows = withdrawals.filter((w) => {
    if (status !== "All" && w.status !== status) return false;
    if (q && !`${w.id} ${w.userId} ${w.wallet}`.toLowerCase().includes(q.toLowerCase()))
      return false;
    return true;
  });

  const decideWd = (w: Withdrawal, to: Withdrawal["status"], verb: string) => {
    setConfirm({
      title: `${verb} ${w.id}?`,
      label: verb,
      run: (reason) => {
        updateWithdrawal(w.id, {
          status: to,
          reviewer: "You",
          history: [...w.history, { action: `${verb}d`, by: "You", time: "Just now" }],
        });
        act(`${verb}d withdrawal`, `${w.id} · ${fmt.money(w.amount, w.currency)}`, reason);
        setSel(null);
      },
    });
  };

  const cols: Column<Withdrawal>[] = [
    {
      key: "id",
      header: "Request",
      cell: (w) => (
        <div>
          <div className="font-semibold">{w.id}</div>
          <Mono>{w.date}</Mono>
        </div>
      ),
    },
    {
      key: "user",
      header: "User",
      cell: (w) => {
        const u = users.find((x) => x.id === w.userId);
        return (
          <div className="flex items-center gap-2">
            <Avatar name={u?.username ?? w.userId} size={28} />
            <Mono>{w.userId}</Mono>
          </div>
        );
      },
    },
    {
      key: "amount",
      header: "Amount",
      cell: (w) => (
        <span className="font-mono font-semibold">{fmt.money(w.amount, w.currency)}</span>
      ),
    },
    { key: "dest", header: "Destination", cell: (w) => <Mono>{w.wallet}</Mono> },
    { key: "status", header: "Status", cell: (w) => <StatusBadge status={w.status} /> },
    {
      key: "reviewer",
      header: "Reviewer",
      cell: (w) => <span className="text-muted-foreground">{w.reviewer ?? "—"}</span>,
    },
    {
      key: "actions",
      header: "Actions",
      cell: (w) => (
        <Button
          size="sm"
          variant="outline"
          className="rounded-lg"
          onClick={(e) => {
            e.stopPropagation();
            setSel(w);
          }}
        >
          Review
        </Button>
      ),
    },
  ];

  const su = sel ? users.find((u) => u.id === sel.userId) : null;

  return (
    <div>
      <PageHeader
        title="Withdrawals"
        subtitle={`${rows.length} requests · approve / reject / flag (Manager+)`}
      />
      <FilterBar>
        <SearchInput
          value={q}
          onChange={setQ}
          placeholder="Search request, user, wallet…"
          className="min-w-64 flex-1"
        />
      </FilterBar>
      <div className="mb-4 flex flex-wrap gap-1">
        {["All", "Pending", "Flagged", "Processing", "Approved", "Rejected", "Completed"].map(
          (s) => (
            <Chip key={s} active={status === s} onClick={() => setStatus(s)}>
              {s}
            </Chip>
          ),
        )}
      </div>
      <DataTable columns={cols} rows={rows} rowKey={(w) => w.id} onRowClick={setSel} />

      <Sheet open={!!sel} onOpenChange={(o) => !o && setSel(null)}>
        <SheetContent className="overflow-y-auto rounded-l-3xl sm:max-w-md">
          {sel && (
            <>
              <SheetHeader>
                <SheetTitle>
                  {sel.id} · {fmt.money(sel.amount, sel.currency)}
                </SheetTitle>
              </SheetHeader>
              <div className="mt-4 space-y-4">
                <StatusBadge status={sel.status} />
                <Panel title="Request">
                  <KV
                    rows={[
                      ["User", <Mono key="u">{sel.userId}</Mono>],
                      ["Account", su ? su.status : "—"],
                      ["Wallet", <Mono key="w">{sel.wallet}</Mono>],
                      ["Reviewer", sel.reviewer ?? "Unassigned"],
                    ]}
                  />
                </Panel>
                {su?.flags.map((f) => (
                  <div
                    key={f}
                    className="rounded-xl bg-danger-soft px-3 py-2 text-sm text-destructive"
                  >
                    {f}
                  </div>
                ))}
                {sel.notes.map((n, i) => (
                  <div key={i} className="rounded-xl bg-warning-soft px-3 py-2 text-sm">
                    {n}
                  </div>
                ))}
                <Panel title="Decision history">
                  {sel.history.map((h, i) => (
                    <div key={i} className="border-b py-2 text-sm last:border-0">
                      <b>{h.action}</b> by {h.by}
                      <br />
                      <Mono>{h.time}</Mono>
                    </div>
                  ))}
                </Panel>
                {decide ? (
                  <div className="flex flex-wrap gap-2">
                    <Button
                      className="rounded-xl"
                      onClick={() => decideWd(sel, "Approved", "Approve")}
                    >
                      Approve
                    </Button>
                    <Button
                      variant="destructive"
                      className="rounded-xl"
                      onClick={() => decideWd(sel, "Rejected", "Reject")}
                    >
                      Reject
                    </Button>
                    <Button
                      variant="outline"
                      className="rounded-xl"
                      onClick={() => decideWd(sel, "Flagged", "Flag")}
                    >
                      Flag
                    </Button>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    Read-only for your role. Decisions require Manager or Owner.
                  </p>
                )}
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
      <ConfirmationModal
        open={!!confirm}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={confirm?.title ?? ""}
        confirmLabel={confirm?.label ?? "Confirm"}
        requireReason
        onConfirm={(r) => confirm?.run(r)}
      />
    </div>
  );
}
