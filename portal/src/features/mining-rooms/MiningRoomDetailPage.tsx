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
  SegmentMeter,
  Avatar,
} from "@/shared/components/primitives";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { ConfirmationModal } from "@/shared/components/ConfirmationModal";

export function MiningRoomDetailPage({ roomId }: { roomId: string }) {
  return (
    <Guard perm="mining.view">
      <Inner id={roomId} />
    </Guard>
  );
}

function Inner({ id }: { id: string }) {
  const { rooms, users, updateRoom, updateUser, can, act } = useStaff();
  const room = rooms.find((r) => r.id === id);
  const [cap, setCap] = useState("");
  const [confirm, setConfirm] = useState<{
    title: string;
    label: string;
    run: (r: string) => void;
  } | null>(null);
  if (!room)
    return (
      <div className="surface mx-auto max-w-md p-10 text-center">
        <h1 className="text-xl font-semibold">Room not found</h1>
        <Link
          to="/mining-rooms"
          className="mt-4 inline-flex h-10 items-center rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground"
        >
          Back
        </Link>
      </div>
    );

  const members = room.members.map((m) => users.find((u) => u.id === m)).filter(Boolean);
  const canManage = can("mining.manageRooms");
  const canKick = can("mining.kick");
  const canDisconnect = can("mining.disconnect");

  return (
    <div>
      <PageHeader
        title={`${room.name} room`}
        subtitle={`${room.id} · Round ${room.round}`}
        actions={
          <Link
            to="/mining-rooms"
            className="rounded-xl border px-3 py-2 text-sm font-medium hover:border-primary/40"
          >
            ← All rooms
          </Link>
        }
      />
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Performance">
          <KV
            rows={[
              ["Status", <StatusBadge key="s" status={room.status} />],
              ["Members", `${room.members.length}/${room.capacity}`],
              ["Speed", `${room.speed} MH/s`],
              [
                "Connection",
                <span key="c" className="flex items-center gap-2">
                  {room.connection}% <SegmentMeter value={room.connection} />
                </span>,
              ],
            ]}
          />
          {canManage && (
            <div className="mt-3 flex gap-2">
              <Input
                value={cap}
                onChange={(e) => setCap(e.target.value)}
                placeholder={`Capacity (${room.capacity})`}
                type="number"
                className="rounded-xl"
              />
              <Button
                className="rounded-xl"
                onClick={() => {
                  const v = parseInt(cap);
                  if (v > 0) {
                    updateRoom(room.id, { capacity: v });
                    act("Changed room capacity", `${room.name} → ${v}`);
                    setCap("");
                  }
                }}
              >
                Save
              </Button>
            </div>
          )}
        </Panel>
        <Panel title={`Members (${members.length})`}>
          {members.map((u) => (
            <div
              key={u!.id}
              className="flex items-center gap-3 border-b py-2.5 text-sm last:border-0"
            >
              <Avatar name={u!.username} size={30} />
              <div className="flex-1">
                <b>{u!.username}</b> <Mono>· {u!.miningSpeed} MH/s</Mono>
                <br />
                <StatusBadge status={u!.miningStatus} />
              </div>
              {canKick && (
                <button
                  className="text-xs font-semibold text-destructive hover:underline"
                  onClick={() =>
                    setConfirm({
                      title: `Kick ${u!.username}?`,
                      label: "Kick",
                      run: (reason) => {
                        updateRoom(room.id, { members: room.members.filter((m) => m !== u!.id) });
                        updateUser(u!.id, { miningStatus: "Idle" });
                        act("Kicked miner", `${u!.id} · ${room.name}`, reason);
                      },
                    })
                  }
                >
                  Kick
                </button>
              )}
              {canDisconnect && u!.miningStatus === "Stuck" && (
                <button
                  className="text-xs font-semibold text-warning hover:underline"
                  onClick={() => {
                    updateUser(u!.id, { miningStatus: "Offline" });
                    act("Disconnected stuck session", u!.id);
                  }}
                >
                  Disconnect
                </button>
              )}
            </div>
          ))}
          {members.length === 0 && <p className="text-sm text-muted-foreground">No members.</p>}
        </Panel>
      </div>
      <Panel title="Round history" className="mt-4">
        {room.history.map((h) => (
          <div key={h.round} className="flex justify-between border-b py-2 text-sm last:border-0">
            <span>Round {h.round}</span>
            <Mono>
              {h.reward} LMP · {h.duration}
            </Mono>
          </div>
        ))}
        {room.history.length === 0 && (
          <p className="text-sm text-muted-foreground">No history yet.</p>
        )}
      </Panel>
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
