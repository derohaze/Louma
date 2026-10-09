import { useState } from "react";
import { Plus } from "lucide-react";
import { useStaff } from "@/shared/lib/staff-store";
import { ROLES, type Role } from "@/shared/lib/permissions";
import {
  Guard,
  PageHeader,
  DataTable,
  StatusBadge,
  RoleBadge,
  Avatar,
  Mono,
  type Column,
} from "@/shared/components/primitives";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/shared/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/shared/ui/dialog";
import { ConfirmationModal } from "@/shared/components/ConfirmationModal";
import type { Staff } from "@/shared/lib/mock-data";

export function StaffPage() {
  return (
    <Guard perm="staff.view">
      <Inner />
    </Guard>
  );
}

function Inner() {
  const { staff, setStaff, can, act, role } = useStaff();
  const isOwner = can("staff.manage");
  const [create, setCreate] = useState(false);
  const [form, setForm] = useState({ name: "", email: "", role: "support" as Role });
  const [confirm, setConfirm] = useState<{
    title: string;
    label: string;
    danger?: boolean;
    run: (r: string) => void;
  } | null>(null);

  const cols: Column<Staff>[] = [
    {
      key: "emp",
      header: "Employee",
      cell: (s) => (
        <div className="flex items-center gap-2.5">
          <Avatar name={s.name} />
          <div>
            <div className="font-semibold">{s.name}</div>
            <Mono>{s.id}</Mono>
          </div>
        </div>
      ),
    },
    { key: "email", header: "Email", cell: (s) => <Mono>{s.email}</Mono> },
    { key: "role", header: "Role", cell: (s) => <RoleBadge role={s.role} /> },
    { key: "status", header: "Status", cell: (s) => <StatusBadge status={s.status} /> },
    {
      key: "login",
      header: "Last login",
      cell: (s) => (
        <span className="text-muted-foreground">
          {s.lastLogin} · {s.sessions} sessions
        </span>
      ),
    },
    {
      key: "actions",
      header: "Actions",
      cell: (s) => (
        <div className="flex gap-1.5" onClick={(e) => e.stopPropagation()}>
          {isOwner && s.role !== "owner" && (
            <>
              <Select
                value={s.role}
                onValueChange={(v) => {
                  setStaff((x) => x.map((y) => (y.id === s.id ? { ...y, role: v as Role } : y)));
                  act("Changed staff role", `${s.name} → ${v}`);
                }}
              >
                <SelectTrigger className="h-8 w-32 rounded-lg text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ROLES.map((r) => (
                    <SelectItem key={r.id} value={r.id}>
                      {r.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {s.status === "Active" ? (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 rounded-lg"
                  onClick={() =>
                    setConfirm({
                      title: `Suspend ${s.name}?`,
                      label: "Suspend",
                      run: (reason) => {
                        setStaff((x) =>
                          x.map((y) => (y.id === s.id ? { ...y, status: "Suspended" } : y)),
                        );
                        act("Suspended staff", s.name, reason);
                      },
                    })
                  }
                >
                  Suspend
                </Button>
              ) : (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 rounded-lg"
                  onClick={() => {
                    setStaff((x) => x.map((y) => (y.id === s.id ? { ...y, status: "Active" } : y)));
                    act("Reactivated staff", s.name);
                  }}
                >
                  Activate
                </Button>
              )}
              <Button
                size="sm"
                variant="ghost"
                className="h-8 rounded-lg text-destructive"
                onClick={() =>
                  setConfirm({
                    title: `Delete ${s.name}?`,
                    label: "Delete",
                    danger: true,
                    run: (reason) => {
                      setStaff((x) => x.filter((y) => y.id !== s.id));
                      act("Deleted staff", s.name, reason);
                    },
                  })
                }
              >
                Delete
              </Button>
            </>
          )}
          {!isOwner && <span className="text-xs text-muted-foreground">Read-only ({role})</span>}
        </div>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Staff"
        subtitle={
          isOwner ? "Full management · Owner only" : "Staff activity · read-only for your role"
        }
        actions={
          isOwner ? (
            <Button className="rounded-xl" onClick={() => setCreate(true)}>
              <Plus className="size-4" /> Add staff
            </Button>
          ) : undefined
        }
      />
      <DataTable columns={cols} rows={staff} rowKey={(s) => s.id} />

      <Dialog open={create} onOpenChange={setCreate}>
        <DialogContent className="rounded-3xl sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>New staff member</DialogTitle>
          </DialogHeader>
          <div className="grid gap-2">
            <Input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="Full name"
              className="rounded-xl"
            />
            <Input
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              placeholder="email@loumapay.com"
              className="rounded-xl"
            />
            <Select value={form.role} onValueChange={(v) => setForm({ ...form, role: v as Role })}>
              <SelectTrigger className="h-10 rounded-xl">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ROLES.filter((r) => r.id !== "owner").map((r) => (
                  <SelectItem key={r.id} value={r.id}>
                    {r.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button
              className="rounded-xl"
              disabled={!form.name.trim() || !form.email.includes("@")}
              onClick={() => {
                setStaff((x) => [
                  ...x,
                  {
                    id: `ST-${Date.now().toString().slice(-3)}`,
                    name: form.name.trim(),
                    email: form.email.trim(),
                    role: form.role,
                    status: "Active",
                    lastLogin: "Never",
                    sessions: 0,
                  },
                ]);
                act("Created staff", `${form.name} · ${form.role}`);
                setCreate(false);
                setForm({ name: "", email: "", role: "support" });
              }}
            >
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
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
