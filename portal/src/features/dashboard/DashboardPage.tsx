import { Link } from "@tanstack/react-router";
import { LifeBuoy, Pickaxe, Users, ArrowUpFromLine, ShieldAlert, Activity } from "lucide-react";
import { useStaff, fmt } from "@/shared/lib/staff-store";
import {
  MetricCard,
  PageHeader,
  Panel,
  StatusBadge,
  Avatar,
  Mono,
} from "@/shared/components/primitives";
import { AuditTimeline } from "@/shared/components/AuditTimeline";

export function DashboardPage() {
  const { role, me, users, withdrawals, rooms, tickets, staff, audit, transactions } = useStaff();
  const pendingWd = withdrawals.filter((w) => w.status === "Pending" || w.status === "Flagged");
  const openTk = tickets.filter((t) => t.status !== "Resolved" && t.status !== "Closed");
  const escalated = tickets.filter((t) => t.status === "Escalated");
  const frozen = users.filter((u) => u.status === "Frozen" || u.status === "Suspended");
  const miningIssues = users.filter((u) => u.miningStatus === "Stuck").length;
  const onlineStaff = staff.filter((s) => s.status === "Active").length;

  const cards: Record<string, React.ReactNode> = {
    support: (
      <>
        <MetricCard
          label="Open Tickets"
          value={openTk.length}
          icon={<LifeBuoy className="size-3.5" />}
          tone="primary"
        />
        <MetricCard
          label="Assigned to me"
          value={tickets.filter((t) => t.assigned === me.name).length}
          icon={<Activity className="size-3.5" />}
          tone="info"
        />
        <MetricCard
          label="Active Users"
          value={fmt.num(users.filter((u) => u.status === "Active").length)}
          icon={<Users className="size-3.5" />}
          tone="success"
        />
        <MetricCard
          label="Mining Issues"
          value={miningIssues}
          icon={<Pickaxe className="size-3.5" />}
          tone="danger"
        />
      </>
    ),
    moderator: (
      <>
        <MetricCard
          label="Open Tickets"
          value={openTk.length}
          icon={<LifeBuoy className="size-3.5" />}
          tone="primary"
        />
        <MetricCard
          label="Reported Users"
          value={users.filter((u) => u.flags.length).length}
          icon={<ShieldAlert className="size-3.5" />}
          tone="warning"
        />
        <MetricCard
          label="Suspended Users"
          value={users.filter((u) => u.status === "Suspended").length}
          icon={<Users className="size-3.5" />}
          tone="warning"
        />
        <MetricCard
          label="Mining Issues"
          value={miningIssues}
          icon={<Pickaxe className="size-3.5" />}
          tone="danger"
        />
      </>
    ),
    senior_moderator: (
      <>
        <MetricCard
          label="Escalated Cases"
          value={escalated.length}
          icon={<ShieldAlert className="size-3.5" />}
          tone="danger"
        />
        <MetricCard
          label="Frozen Accounts"
          value={users.filter((u) => u.status === "Frozen").length}
          icon={<Users className="size-3.5" />}
          tone="info"
        />
        <MetricCard
          label="Suspicious Users"
          value={users.filter((u) => u.flags.length).length}
          icon={<Activity className="size-3.5" />}
          tone="warning"
        />
        <MetricCard
          label="Mining Problems"
          value={miningIssues}
          icon={<Pickaxe className="size-3.5" />}
          tone="danger"
        />
      </>
    ),
    manager: (
      <>
        <MetricCard
          label="Total Users"
          value={fmt.num(users.length)}
          icon={<Users className="size-3.5" />}
          tone="primary"
        />
        <MetricCard
          label="Pending Withdrawals"
          value={pendingWd.length}
          icon={<ArrowUpFromLine className="size-3.5" />}
          tone="warning"
        />
        <MetricCard
          label="Mining Rooms"
          value={rooms.length}
          icon={<Pickaxe className="size-3.5" />}
          tone="info"
        />
        <MetricCard
          label="Staff Online"
          value={onlineStaff}
          icon={<Activity className="size-3.5" />}
          tone="success"
        />
      </>
    ),
    owner: (
      <>
        <MetricCard
          label="Total Users"
          value={fmt.num(users.length)}
          icon={<Users className="size-3.5" />}
          tone="primary"
        />
        <MetricCard
          label="Online Miners"
          value={fmt.num(users.filter((u) => u.miningStatus === "Mining").length)}
          icon={<Pickaxe className="size-3.5" />}
          tone="success"
        />
        <MetricCard
          label="Pending Withdrawals"
          value={pendingWd.length}
          icon={<ArrowUpFromLine className="size-3.5" />}
          tone="warning"
        />
        <MetricCard
          label="Security Alerts"
          value={escalated.length + frozen.length}
          icon={<ShieldAlert className="size-3.5" />}
          tone="danger"
        />
      </>
    ),
  };

  return (
    <div>
      <PageHeader
        title={role === "owner" ? "Platform overview" : `${role.replace("_", " ")} workspace`}
        subtitle={`Signed in as ${me.name} · mock data, frontend only`}
      />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{cards[role]}</div>

      <div className="mt-4 grid gap-4 xl:grid-cols-3">
        <Panel
          title="Support queue"
          action={
            <Link to="/tickets" className="text-xs font-semibold text-primary hover:underline">
              View all
            </Link>
          }
          className="xl:col-span-2"
        >
          <div className="space-y-2">
            {openTk.slice(0, 5).map((t) => (
              <Link
                key={t.id}
                to="/tickets/$id"
                params={{ id: t.id }}
                className="flex items-center gap-3 rounded-xl px-3 py-2.5 transition hover:bg-muted"
              >
                <Avatar name={t.subject} size={32} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{t.subject}</div>
                  <Mono>
                    {t.id} · {t.updated}
                  </Mono>
                </div>
                <StatusBadge status={t.status} />
              </Link>
            ))}
            {openTk.length === 0 && (
              <p className="py-6 text-center text-sm text-muted-foreground">Queue is clear.</p>
            )}
          </div>
        </Panel>
        <Panel title="Recent staff activity">
          <AuditTimeline entries={audit.slice(0, 5)} />
        </Panel>
      </div>

      {(role === "manager" || role === "owner") && (
        <div className="mt-4 grid gap-4 xl:grid-cols-3">
          <Panel
            title="Withdrawal queue"
            action={
              <Link
                to="/withdrawals"
                className="text-xs font-semibold text-primary hover:underline"
              >
                Review
              </Link>
            }
            className="xl:col-span-2"
          >
            <div className="space-y-2">
              {pendingWd.slice(0, 5).map((w) => (
                <div
                  key={w.id}
                  className="flex items-center gap-3 rounded-xl px-3 py-2.5 hover:bg-muted"
                >
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium">
                      {w.id} · {fmt.money(w.amount, w.currency)}
                    </div>
                    <Mono>
                      {w.userId} · {w.date}
                    </Mono>
                  </div>
                  <StatusBadge status={w.status} />
                </div>
              ))}
            </div>
          </Panel>
          <Panel
            title="Recent transactions"
            action={
              <Link
                to="/transactions"
                className="text-xs font-semibold text-primary hover:underline"
              >
                View all
              </Link>
            }
          >
            <div className="space-y-2">
              {transactions.slice(0, 5).map((t) => (
                <div
                  key={t.id}
                  className="flex items-center justify-between rounded-xl px-3 py-2 text-sm hover:bg-muted"
                >
                  <span className="font-mono text-xs text-muted-foreground">{t.id}</span>
                  <span className="font-semibold">{fmt.money(t.amount, t.currency)}</span>
                </div>
              ))}
            </div>
          </Panel>
        </div>
      )}
    </div>
  );
}
