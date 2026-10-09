import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { Plus } from "lucide-react";
import { useStaff } from "@/shared/lib/staff-store";
import {
  Guard,
  PageHeader,
  StatusBadge,
  SegmentMeter,
  Panel,
  Mono,
} from "@/shared/components/primitives";
import { Button } from "@/shared/ui/button";
import { ConfirmationModal } from "@/shared/components/ConfirmationModal";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/shared/ui/dialog";
import { Input } from "@/shared/ui/input";

export function MiningRoomsPage() {
  return (
    <Guard perm="mining.view">
      <Inner />
    </Guard>
  );
}

function Inner() {
  const { rooms, users, updateRoom, addRoom, updateUser, can, act } = useStaff();
  const [confirm, setConfirm] = useState<{
    title: string;
    label: string;
    danger?: boolean;
    run: (r: string) => void;
  } | null>(null);
  const [create, setCreate] = useState(false);
  const [name, setName] = useState("");
  const [cap, setCap] = useState("50");
  const canManage = can("mining.manageRooms");
  const canKick = can("mining.kick");

  const kick = (roomId: string, userId: string) => {
    setConfirm({
      title: `Kick ${userId} from room?`,
      label: "Kick",
      run: (reason) => {
        const room = rooms.find((r) => r.id === roomId)!;
        updateRoom(roomId, { members: room.members.filter((m) => m !== userId) });
        updateUser(userId, { miningStatus: "Idle", room: "—" });
        act("Kicked miner", `${userId} · ${room.name}`, reason);
      },
    });
  };

  return (
    <div>
      <PageHeader
        title="Mining rooms"
        subtitle={
          canManage
            ? "Full operational control"
            : canKick
              ? "Kick inactive miners"
              : "View only for your role"
        }
        actions={
          canManage ? (
            <Button className="rounded-xl" onClick={() => setCreate(true)}>
              <Plus className="size-4" /> New room
            </Button>
          ) : undefined
        }
      />
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {rooms.map((r) => (
          <div key={r.id} className="surface lift p-5">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold">{r.name}</h3>
              <StatusBadge status={r.status} />
            </div>
            <Mono>
              Round {r.round} · {r.speed} MH/s
            </Mono>
            <div className="mt-3">
              <div className="mb-1 flex justify-between text-xs text-muted-foreground">
                <span>
                  {r.members.length}/{r.capacity} miners
                </span>
                <span>{r.connection}% connection</span>
              </div>
              <SegmentMeter
                value={(r.members.length / r.capacity) * 100}
                tone={r.status === "Degraded" ? "warning" : "primary"}
              />
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <Link
                to="/mining-rooms/$id"
                params={{ id: r.id }}
                className="rounded-xl bg-primary-soft px-3 py-1.5 text-xs font-semibold text-primary hover:bg-primary hover:text-primary-foreground"
              >
                Open details
              </Link>
              {canManage && r.status === "Open" && (
                <button
                  onClick={() =>
                    setConfirm({
                      title: `Close ${r.name}?`,
                      label: "Close room",
                      danger: true,
                      run: (reason) => {
                        updateRoom(r.id, { status: "Closed" });
                        act("Closed mining room", r.name, reason);
                      },
                    })
                  }
                  className="rounded-xl border px-3 py-1.5 text-xs font-semibold hover:border-primary/40"
                >
                  Close
                </button>
              )}
              {canManage && r.status !== "Open" && (
                <button
                  onClick={() => {
                    updateRoom(r.id, { status: "Open" });
                    act("Opened mining room", r.name);
                  }}
                  className="rounded-xl border px-3 py-1.5 text-xs font-semibold hover:border-primary/40"
                >
                  Open
                </button>
              )}
            </div>
            {canKick && (
              <div className="mt-3 space-y-1 border-t pt-3">
                {r.members.slice(0, 3).map((m) => {
                  const u = users.find((x) => x.id === m);
                  return (
                    <div key={m} className="flex items-center justify-between text-xs">
                      <span>
                        {u?.username ?? m} ·{" "}
                        <span className="text-muted-foreground">{u?.miningStatus}</span>
                      </span>
                      <button
                        onClick={() => kick(r.id, m)}
                        className="font-semibold text-destructive hover:underline"
                      >
                        Kick
                      </button>
                    </div>
                  );
                })}
                {r.members.length === 0 && (
                  <p className="text-xs text-muted-foreground">Room is empty.</p>
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      <Dialog open={create} onOpenChange={setCreate}>
        <DialogContent className="rounded-3xl sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>New mining room</DialogTitle>
          </DialogHeader>
          <div className="grid gap-2">
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Room name"
              className="rounded-xl"
            />
            <Input
              value={cap}
              onChange={(e) => setCap(e.target.value)}
              placeholder="Capacity"
              type="number"
              className="rounded-xl"
            />
          </div>
          <DialogFooter>
            <Button
              className="rounded-xl"
              disabled={!name.trim()}
              onClick={() => {
                addRoom({
                  id: `RM-${Date.now().toString().slice(-4)}`,
                  name: name.trim(),
                  status: "Open",
                  members: [],
                  capacity: parseInt(cap) || 50,
                  speed: 300,
                  round: 1870,
                  connection: 95,
                  history: [],
                });
                act("Created mining room", name.trim());
                setCreate(false);
                setName("");
              }}
            >
              Create room
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Panel title="How roles work" className="mt-4">
        <p className="text-sm text-muted-foreground">
          Support: view only · Moderator: kick inactive · Senior: kick + disconnect · Manager/Owner:
          open, close, capacity, create.
        </p>
      </Panel>
      <ConfirmationModal
        open={!!confirm}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={confirm?.title ?? ""}
        confirmLabel={confirm?.label ?? "Confirm"}
        danger={confirm?.danger ?? false}
        requireReason
        onConfirm={(r) => confirm?.run(r)}
      />
    </div>
  );
}
