import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useStaff } from "@/shared/lib/staff-store";
import {
  Guard,
  PageHeader,
  StatusBadge,
  Panel,
  KV,
  Mono,
  Avatar,
} from "@/shared/components/primitives";
import { Button } from "@/shared/ui/button";
import { Textarea } from "@/shared/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/shared/ui/select";

export function TicketDetailPage({ ticketId }: { ticketId: string }) {
  return (
    <Guard perm="tickets.view">
      <Inner id={ticketId} />
    </Guard>
  );
}

function Inner({ id }: { id: string }) {
  const { tickets, updateTicket, users, can, act, me } = useStaff();
  const t = tickets.find((x) => x.id === id);
  const [reply, setReply] = useState("");
  const [note, setNote] = useState("");
  if (!t)
    return (
      <div className="surface mx-auto max-w-md p-10 text-center">
        <h1 className="text-xl font-semibold">Ticket not found</h1>
        <Link
          to="/tickets"
          className="mt-4 inline-flex h-10 items-center rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground"
        >
          Back
        </Link>
      </div>
    );
  const user = users.find((u) => u.id === t.userId);
  const canReply = can("tickets.reply");
  const canEscalate = can("cases.escalate");

  const sendReply = () => {
    if (reply.trim().length < 2) return;
    updateTicket(t.id, {
      messages: [
        ...t.messages,
        { from: "staff", name: me.name, text: reply.trim(), time: "Just now" },
      ],
      status: t.status === "New" ? "Open" : t.status,
    });
    act("Replied to ticket", t.id, reply.trim().slice(0, 80));
    setReply("");
  };

  return (
    <div>
      <PageHeader
        title={t.subject}
        subtitle={`${t.id} · ${t.updated}`}
        actions={
          <Link
            to="/tickets"
            className="rounded-xl border px-3 py-2 text-sm font-medium hover:border-primary/40"
          >
            ← All tickets
          </Link>
        }
      />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <StatusBadge status={t.status} />
        <StatusBadge status={t.priority} />
        <span className="text-sm text-muted-foreground">
          Assigned: {t.assigned ?? "Unassigned"}
        </span>
        <div className="ml-auto flex gap-2">
          <Select
            value={t.status}
            onValueChange={(v) => {
              updateTicket(t.id, { status: v as typeof t.status });
              act(`Set ticket ${v}`, t.id);
            }}
          >
            <SelectTrigger className="h-9 w-36 rounded-xl">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {["New", "Open", "Waiting", "Escalated", "Resolved", "Closed"].map((s) => (
                <SelectItem key={s} value={s}>
                  {s}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {canEscalate && t.status !== "Escalated" && (
            <Button
              size="sm"
              variant="outline"
              className="rounded-xl"
              onClick={() => {
                updateTicket(t.id, { status: "Escalated" });
                act("Escalated ticket", t.id, "Needs senior review");
              }}
            >
              Escalate
            </Button>
          )}
        </div>
      </div>
      <div className="grid gap-4 xl:grid-cols-3">
        <div className="space-y-4 xl:col-span-2">
          <Panel title="Conversation">
            <div className="space-y-3">
              {t.messages.map((m, i) => (
                <div
                  key={i}
                  className={`flex gap-3 ${m.from === "staff" ? "flex-row-reverse" : ""}`}
                >
                  <Avatar name={m.name} size={32} />
                  <div
                    className={`max-w-[80%] rounded-2xl px-4 py-2.5 text-sm ${m.from === "staff" ? "bg-primary text-primary-foreground" : "bg-muted"}`}
                  >
                    <div className="mb-0.5 text-xs opacity-70">
                      {m.name} · {m.time}
                    </div>
                    {m.text}
                  </div>
                </div>
              ))}
            </div>
            {canReply ? (
              <div className="mt-4 flex gap-2">
                <Textarea
                  value={reply}
                  onChange={(e) => setReply(e.target.value)}
                  placeholder="Write a reply…"
                  className="rounded-xl"
                  rows={2}
                />
                <Button
                  className="rounded-xl"
                  disabled={reply.trim().length < 2}
                  onClick={sendReply}
                >
                  Send
                </Button>
              </div>
            ) : (
              <p className="mt-4 text-sm text-muted-foreground">Read-only for your role.</p>
            )}
          </Panel>
          <Panel title="Internal notes">
            {t.notes.map((n, i) => (
              <div key={i} className="surface-inset mb-2 px-3 py-2 text-sm">
                <b>{n.by}</b> · {n.time}
                <br />
                {n.text}
              </div>
            ))}
            <div className="flex gap-2">
              <Textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Add internal note…"
                className="rounded-xl"
                rows={2}
              />
              <Button
                variant="outline"
                className="rounded-xl"
                disabled={note.trim().length < 2}
                onClick={() => {
                  updateTicket(t.id, {
                    notes: [...t.notes, { by: me.name, text: note.trim(), time: "Just now" }],
                  });
                  act("Added ticket note", t.id, note.trim());
                  setNote("");
                }}
              >
                Add
              </Button>
            </div>
          </Panel>
        </div>
        <div>
          <Panel title="User context">
            {user ? (
              <KV
                rows={[
                  [
                    "User",
                    <Link
                      key="u"
                      to="/users/$id"
                      params={{ id: user.id }}
                      className="font-semibold text-primary hover:underline"
                    >
                      {user.username}
                    </Link>,
                  ],
                  ["Status", <StatusBadge key="s" status={user.status} />],
                  ["Wallet", <Mono key="w">{user.wallet}</Mono>],
                  ["Mining", <StatusBadge key="m" status={user.miningStatus} />],
                  ["Balance", `${user.balance.toLocaleString()} LMP`],
                ]}
              />
            ) : (
              <p className="text-sm text-muted-foreground">Unknown user.</p>
            )}
          </Panel>
        </div>
      </div>
    </div>
  );
}
