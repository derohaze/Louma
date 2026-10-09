import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { toast } from "sonner";
import {
  defaultMatrix,
  roleLabel,
  type Permission,
  type PermissionMatrix,
  type Role,
} from "./permissions";
import {
  AUDIT,
  ROOMS,
  STAFF,
  TICKETS,
  USERS,
  WITHDRAWALS,
  TRANSACTIONS,
  type AuditEntry,
  type MiningRoom,
  type Staff,
  type Ticket,
  type User,
  type Withdrawal,
  type Transaction,
} from "./mock-data";

const ACTING_AS: Record<Role, string> = {
  owner: "Nadia Farouk",
  manager: "Omar Nabil",
  senior_moderator: "Karim Mostafa",
  moderator: "Salma Tarek",
  support: "Laila Hassan",
};

interface Store {
  role: Role;
  setRole: (r: Role) => void;
  signOut: () => void;
  me: { name: string; email: string; role: Role };
  can: (p: Permission) => boolean;
  matrix: PermissionMatrix;
  togglePermission: (r: Role, p: Permission) => void;
  users: User[];
  updateUser: (id: string, patch: Partial<User>) => void;
  transactions: Transaction[];
  addTransaction: (t: Transaction) => void;
  withdrawals: Withdrawal[];
  updateWithdrawal: (id: string, patch: Partial<Withdrawal>) => void;
  rooms: MiningRoom[];
  updateRoom: (id: string, patch: Partial<MiningRoom>) => void;
  addRoom: (r: MiningRoom) => void;
  tickets: Ticket[];
  updateTicket: (id: string, patch: Partial<Ticket>) => void;
  staff: Staff[];
  setStaff: (fn: (s: Staff[]) => Staff[]) => void;
  audit: AuditEntry[];
  /** Record a simulated action in the audit log and show a toast. */
  act: (action: string, target: string, reason?: string) => void;
}

const Ctx = createContext<Store | null>(null);
const now = () =>
  new Date().toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

export function StaffProvider({ children }: { children: ReactNode }) {
  const [role, setRoleState] = useState<Role>("owner");
  const [matrix, setMatrix] = useState<PermissionMatrix>(defaultMatrix);
  const [users, setUsers] = useState(USERS);
  const [transactions, setTx] = useState(TRANSACTIONS);
  const [withdrawals, setWd] = useState(WITHDRAWALS);
  const [rooms, setRooms] = useState(ROOMS);
  const [tickets, setTickets] = useState(TICKETS);
  const [staff, setStaffState] = useState(STAFF);
  const [audit, setAudit] = useState(AUDIT);

  useEffect(() => {
    const saved = localStorage.getItem("louma.viewAs") as Role | null;
    if (saved) setRoleState(saved);
  }, []);

  const setRole = useCallback((r: Role) => {
    setRoleState(r);
    localStorage.setItem("louma.viewAs", r);
    toast(`Viewing as ${roleLabel(r)}`);
  }, []);

  /**
   * Ends the mock preview session: drops the persisted role and falls back to
   * the lowest-privilege role. This console has no login page, so the sidebar
   * and the permission guards visibly react to the signed-out state instead.
   */
  const signOut = useCallback(() => {
    localStorage.removeItem("louma.viewAs");
    setRoleState("support");
    toast("Signed out — preview continues as Support");
  }, []);

  const me = useMemo(() => {
    const name = ACTING_AS[role];
    return { name, email: staff.find((s) => s.name === name)?.email ?? "", role };
  }, [role, staff]);

  const can = useCallback((p: Permission) => role === "owner" || !!matrix[role][p], [role, matrix]);

  const act = useCallback(
    (action: string, target: string, reason = "—") => {
      setAudit((a) => [
        {
          id: `A-${Date.now()}`,
          time: now(),
          staff: ACTING_AS[role],
          role,
          action,
          target,
          reason,
          status: "Success",
        },
        ...a,
      ]);
      toast.success(action, { description: target });
    },
    [role],
  );

  const value: Store = {
    role,
    setRole,
    signOut,
    me,
    can,
    matrix,
    togglePermission: (r, p) => setMatrix((m) => ({ ...m, [r]: { ...m[r], [p]: !m[r][p] } })),
    users,
    updateUser: (id, patch) =>
      setUsers((u) => u.map((x) => (x.id === id ? { ...x, ...patch } : x))),
    transactions,
    addTransaction: (t) => setTx((x) => [t, ...x]),
    withdrawals,
    updateWithdrawal: (id, patch) =>
      setWd((w) => w.map((x) => (x.id === id ? { ...x, ...patch } : x))),
    rooms,
    updateRoom: (id, patch) =>
      setRooms((r) => r.map((x) => (x.id === id ? { ...x, ...patch } : x))),
    addRoom: (r) => setRooms((x) => [...x, r]),
    tickets,
    updateTicket: (id, patch) =>
      setTickets((t) => t.map((x) => (x.id === id ? { ...x, ...patch } : x))),
    staff,
    setStaff: (fn) => setStaffState(fn),
    audit,
    act,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useStaff() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useStaff must be used inside StaffProvider");
  return c;
}

export const fmt = {
  money: (n: number, c = "LMP") =>
    `${n < 0 ? "−" : ""}${Math.abs(n).toLocaleString("en-US", { maximumFractionDigits: 2 })} ${c}`,
  num: (n: number) => n.toLocaleString("en-US"),
};
