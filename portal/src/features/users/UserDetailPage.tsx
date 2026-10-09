import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useStaff, fmt } from "@/shared/lib/staff-store";
import {
  Guard,
  PageHeader,
  StatusBadge,
  Avatar,
  Panel,
  KV,
  Mono,
  SegmentMeter,
} from "@/shared/components/primitives";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/shared/ui/tabs";
import { Button } from "@/shared/ui/button";
import { Textarea } from "@/shared/ui/textarea";
import { Input } from "@/shared/ui/input";
import { ConfirmationModal } from "@/shared/components/ConfirmationModal";

export function UserDetailPage({ userId }: { userId: string }) {
  return (
    <Guard perm="users.view">
      <Inner id={userId} />
    </Guard>
  );
}

function Inner({ id }: { id: string }) {
  const { users, updateUser, transactions, withdrawals, tickets, can, act, addTransaction } =
    useStaff();
  const user = users.find((u) => u.id === id);
  const [confirm, setConfirm] = useState<{
    title: string;
    label: string;
    danger?: boolean;
    run: (reason: string) => void;
  } | null>(null);
  const [note, setNote] = useState("");
  const [adj, setAdj] = useState({ amount: "", currency: "LMP", ticket: "", note: "" });

  if (!user) {
    return (
      <div className="surface mx-auto max-w-md p-10 text-center">
        <h1 className="text-xl font-semibold">User not found</h1>
        <Link
          to="/users"
          className="mt-4 inline-flex h-10 items-center rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground"
        >
          Back to users
        </Link>
      </div>
    );
  }

  const doAction = (action: string, patch: Partial<typeof user>, label: string) => {
    setConfirm({
      title: action,
      label,
      danger: patch.status === "Banned" || patch.status === "Frozen",
      run: (reason) => {
        updateUser(user.id, patch);
        act(action, `${user.id} · ${user.username}`, reason);
      },
    });
  };

  const userTx = transactions.filter((t) => t.userId === user.id).slice(0, 8);
  const userWd = withdrawals.filter((w) => w.userId === user.id);
  const userTk = tickets.filter((t) => t.userId === user.id);

  const submitAdjust = () => {
    const amount = parseFloat(adj.amount);
    if (!amount || !adj.ticket.trim() || !adj.note.trim()) return;
    updateUser(user.id, { balance: user.balance + amount });
    addTransaction({
      id: `TX-${Date.now().toString().slice(-6)}`,
      userId: user.id,
      type: "Adjustment",
      amount,
      currency: adj.currency,
      status: "Completed",
      date: "Just now",
    });
    act(
      `Adjusted balance ${amount > 0 ? "+" : ""}${amount} ${adj.currency}`,
      `${user.id} · ticket ${adj.ticket}`,
      adj.note,
    );
    setAdj({ amount: "", currency: "LMP", ticket: "", note: "" });
  };

  return (
    <div>
      <PageHeader
        title={user.username}
        subtitle={`${user.id} · ${user.email}`}
        actions={
          <Link
            to="/users"
            className="rounded-xl border px-3 py-2 text-sm font-medium transition hover:border-primary/40"
          >
            ← All users
          </Link>
        }
      />
      <div className="surface mb-4 flex flex-wrap items-center gap-4 p-5">
        <Avatar name={user.username} size={52} />
        <div className="min-w-40 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={user.status} />
            <StatusBadge status={user.miningStatus} />
            {user.flags.map((f) => (
              <StatusBadge key={f} status="Flagged" />
            ))}
          </div>
          <Mono>
            {user.wallet} · {user.country} · {user.lastActive}
          </Mono>
        </div>
        <div className="flex flex-wrap gap-2">
          {can("users.forceLogout") && (
            <Button
              size="sm"
              variant="outline"
              className="rounded-xl"
              onClick={() => doAction("Forced logout session", {}, "Force logout")}
            >
              Force logout
            </Button>
          )}
          {can("users.forceLogoutAll") && (
            <Button
              size="sm"
              variant="outline"
              className="rounded-xl"
              onClick={() => doAction("Forced logout all sessions", {}, "Logout all")}
            >
              Logout all
            </Button>
          )}
          {can("users.suspend") && user.status !== "Suspended" && (
            <Button
              size="sm"
              variant="outline"
              className="rounded-xl"
              onClick={() => doAction("Suspended user", { status: "Suspended" }, "Suspend")}
            >
              Suspend
            </Button>
          )}
          {can("users.suspend") && user.status === "Suspended" && (
            <Button
              size="sm"
              variant="outline"
              className="rounded-xl"
              onClick={() => doAction("Unsuspended user", { status: "Active" }, "Unsuspend")}
            >
              Unsuspend
            </Button>
          )}
          {can("users.freeze") && user.status !== "Frozen" && (
            <Button
              size="sm"
              variant="outline"
              className="rounded-xl"
              onClick={() => doAction("Froze account", { status: "Frozen" }, "Freeze")}
            >
              Freeze
            </Button>
          )}
          {can("users.freeze") && user.status === "Frozen" && (
            <Button
              size="sm"
              variant="outline"
              className="rounded-xl"
              onClick={() => doAction("Unfroze account", { status: "Active" }, "Unfreeze")}
            >
              Unfreeze
            </Button>
          )}
          {can("users.ban") && user.status !== "Banned" && (
            <Button
              size="sm"
              variant="destructive"
              className="rounded-xl"
              onClick={() => doAction("Banned user", { status: "Banned" }, "Ban")}
            >
              Ban
            </Button>
          )}
          {can("users.ban") && user.status === "Banned" && (
            <Button
              size="sm"
              variant="outline"
              className="rounded-xl"
              onClick={() => doAction("Unbanned user", { status: "Active" }, "Unban")}
            >
              Unban
            </Button>
          )}
        </div>
      </div>

      <Tabs defaultValue="overview">
        <TabsList className="mb-4 flex flex-wrap rounded-2xl">
          {[
            "overview",
            "wallet",
            "transactions",
            "mining",
            "devices",
            "sessions",
            "support",
            "activity",
          ].map((t) => (
            <TabsTrigger key={t} value={t} className="rounded-xl capitalize">
              {t}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="overview">
          <div className="grid gap-4 lg:grid-cols-2">
            <Panel title="Profile">
              <KV
                rows={[
                  ["User ID", <Mono key="a">{user.id}</Mono>],
                  ["Email", <Mono key="b">{user.email}</Mono>],
                  ["Wallet", <Mono key="c">{user.wallet}</Mono>],
                  ["Registered", user.registered],
                  ["Country", user.country],
                ]}
              />
            </Panel>
            <Panel
              title="Internal notes"
              action={<span className="text-xs text-muted-foreground">{user.notes.length}</span>}
            >
              <div className="space-y-2">
                {user.notes.map((n, i) => (
                  <div key={i} className="surface-inset px-3 py-2 text-sm">
                    <b>{n.by}</b> · <span className="text-muted-foreground">{n.time}</span>
                    <br />
                    {n.text}
                  </div>
                ))}
                {can("users.notes") && (
                  <div className="flex gap-2">
                    <Textarea
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                      placeholder="Add internal note…"
                      className="rounded-xl"
                      rows={2}
                    />
                    <Button
                      className="rounded-xl"
                      disabled={note.trim().length < 2}
                      onClick={() => {
                        updateUser(user.id, {
                          notes: [
                            ...user.notes,
                            { by: "You", text: note.trim(), time: "Just now" },
                          ],
                        });
                        act("Added support note", user.id, note.trim());
                        setNote("");
                      }}
                    >
                      Add
                    </Button>
                  </div>
                )}
              </div>
            </Panel>
          </div>
        </TabsContent>

        <TabsContent value="wallet">
          <div className="grid gap-4 lg:grid-cols-2">
            <Panel title="Balance">
              <div className="font-mono text-3xl font-medium">
                {can("wallet.viewBalance") ? fmt.money(user.balance) : "••• restricted"}
              </div>
              <div className="mt-3">
                <KV
                  rows={[
                    ["Withdrawals", String(userWd.length)],
                    ["Pending", String(userWd.filter((w) => w.status === "Pending").length)],
                  ]}
                />
              </div>
            </Panel>
            {can("wallet.adjust") ? (
              <Panel title="Manual adjustment (Manager+)">
                <div className="grid gap-2">
                  <div className="flex gap-2">
                    <Input
                      value={adj.amount}
                      onChange={(e) => setAdj({ ...adj, amount: e.target.value })}
                      placeholder="Amount (+/-)"
                      type="number"
                      className="rounded-xl"
                    />
                    <Input
                      value={adj.currency}
                      onChange={(e) => setAdj({ ...adj, currency: e.target.value })}
                      placeholder="LMP"
                      className="w-24 rounded-xl"
                    />
                  </div>
                  <Input
                    value={adj.ticket}
                    onChange={(e) => setAdj({ ...adj, ticket: e.target.value })}
                    placeholder="Support ticket number (required)"
                    className="rounded-xl"
                  />
                  <Textarea
                    value={adj.note}
                    onChange={(e) => setAdj({ ...adj, note: e.target.value })}
                    placeholder="Internal note + reason (required)"
                    className="rounded-xl"
                    rows={2}
                  />
                  <Button
                    className="rounded-xl"
                    onClick={submitAdjust}
                    disabled={!parseFloat(adj.amount) || !adj.ticket.trim() || !adj.note.trim()}
                  >
                    Apply adjustment
                  </Button>
                </div>
              </Panel>
            ) : (
              <Panel title="Balance controls">
                <p className="text-sm text-muted-foreground">
                  Your role is read-only for balances. Balances are visible to Manager and above.
                </p>
              </Panel>
            )}
          </div>
        </TabsContent>

        <TabsContent value="transactions">
          <Panel title={`Transactions (${userTx.length})`}>
            {userTx.map((t) => (
              <div
                key={t.id}
                className="flex items-center justify-between border-b py-2.5 text-sm last:border-0"
              >
                <span>
                  <b>{t.type}</b> ·{" "}
                  <Mono>
                    {t.id} · {t.date}
                  </Mono>
                </span>
                <span className="flex items-center gap-2 font-mono font-medium">
                  {fmt.money(t.amount, t.currency)}
                  <StatusBadge status={t.status} />
                </span>
              </div>
            ))}
            {userTx.length === 0 && (
              <p className="text-sm text-muted-foreground">No transactions.</p>
            )}
          </Panel>
        </TabsContent>

        <TabsContent value="mining">
          <Panel title="Mining status">
            <KV
              rows={[
                ["Status", <StatusBadge key="s" status={user.miningStatus} />],
                ["Speed", `${user.miningSpeed} MH/s`],
                ["Room", user.room],
                [
                  "Connection",
                  <span key="c" className="flex items-center gap-2">
                    {user.connection}% <SegmentMeter value={user.connection} />
                  </span>,
                ],
              ]}
            />
          </Panel>
        </TabsContent>

        <TabsContent value="devices">
          <Panel title={`Devices (${user.devices.length})`}>
            {user.devices.map((d, i) => (
              <div key={i} className="border-b py-2.5 text-sm last:border-0">
                <b>{d.name}</b> · {d.os}
                <br />
                <Mono>
                  {d.ip} · {d.lastSeen}
                </Mono>
              </div>
            ))}
          </Panel>
        </TabsContent>

        <TabsContent value="sessions">
          <Panel title={`Sessions (${user.sessions.length})`}>
            {user.sessions.map((s) => (
              <div
                key={s.id}
                className="flex items-center justify-between border-b py-2.5 text-sm last:border-0"
              >
                <span>
                  <b>{s.id}</b> · {s.location}
                  <br />
                  <Mono>
                    {s.ip} · {s.started}
                  </Mono>
                </span>
                <StatusBadge status={s.active ? "Active" : "Closed"} />
              </div>
            ))}
          </Panel>
        </TabsContent>

        <TabsContent value="support">
          <Panel title={`Tickets (${userTk.length})`}>
            {userTk.map((t) => (
              <div
                key={t.id}
                className="flex items-center justify-between border-b py-2.5 text-sm last:border-0"
              >
                <span>
                  <b>{t.subject}</b>
                  <br />
                  <Mono>{t.id}</Mono>
                </span>
                <StatusBadge status={t.status} />
              </div>
            ))}
            {userTk.length === 0 && <p className="text-sm text-muted-foreground">No tickets.</p>}
          </Panel>
        </TabsContent>

        <TabsContent value="activity">
          <Panel title="Flags & security">
            {can("users.security") ? (
              user.flags.length ? (
                user.flags.map((f) => (
                  <div key={f} className="surface-inset mb-2 px-3 py-2 text-sm">
                    {f}
                  </div>
                ))
              ) : (
                <p className="text-sm text-muted-foreground">
                  No flags. Extended activity: 14 logins this week, no anomalies.
                </p>
              )
            ) : (
              <p className="text-sm text-muted-foreground">
                Extended activity is visible to Senior Moderator and above.
              </p>
            )}
          </Panel>
        </TabsContent>
      </Tabs>

      <ConfirmationModal
        open={!!confirm}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={confirm?.title ?? ""}
        confirmLabel={confirm?.label ?? "Confirm"}
        danger={confirm?.danger ?? false}
        requireReason
        onConfirm={(r) => confirm?.run(r)}
        description={`${user.id} · ${user.username}`}
      />
    </div>
  );
}
