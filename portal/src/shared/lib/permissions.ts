// Centralized role & permission configuration.
export type Role = "support" | "moderator" | "senior_moderator" | "manager" | "owner";

export const ROLES: { id: Role; label: string; rank: number; summary: string }[] = [
  { id: "support", label: "Support", rank: 1, summary: "Customer assistance, tickets and lookups" },
  {
    id: "moderator",
    label: "Moderator",
    rank: 2,
    summary: "Session moderation and temporary suspensions",
  },
  {
    id: "senior_moderator",
    label: "Senior Moderator",
    rank: 3,
    summary: "Escalations, freezes and security review",
  },
  {
    id: "manager",
    label: "Manager",
    rank: 4,
    summary: "Operations, balances, withdrawals and mining",
  },
  { id: "owner", label: "Owner", rank: 5, summary: "Full platform access" },
];

export const roleLabel = (r: Role) => ROLES.find((x) => x.id === r)!.label;
export const roleRank = (r: Role) => ROLES.find((x) => x.id === r)!.rank;

export type PermissionCategory =
  "Users" | "Wallet" | "Withdrawals" | "Mining" | "Support" | "Staff" | "System" | "Logs";

export type Permission =
  | "users.view"
  | "users.notes"
  | "users.forceLogout"
  | "users.suspend"
  | "users.freeze"
  | "users.forceLogoutAll"
  | "users.security"
  | "users.ban"
  | "users.ip"
  | "wallet.viewBalance"
  | "wallet.adjust"
  | "transactions.view"
  | "withdrawals.view"
  | "withdrawals.decide"
  | "mining.view"
  | "mining.kick"
  | "mining.disconnect"
  | "mining.manageRooms"
  | "mining.rounds"
  | "mining.economy"
  | "tickets.view"
  | "tickets.reply"
  | "cases.escalate"
  | "moderation.history"
  | "staff.view"
  | "staff.manage"
  | "roles.manage"
  | "audit.view"
  | "system.settings";

export const PERMISSIONS: Record<
  Permission,
  { label: string; category: PermissionCategory; minRole: Role }
> = {
  "users.view": { label: "View users", category: "Users", minRole: "support" },
  "users.notes": { label: "Add internal notes", category: "Users", minRole: "support" },
  "users.forceLogout": { label: "Force logout session", category: "Users", minRole: "moderator" },
  "users.suspend": { label: "Suspend users", category: "Users", minRole: "moderator" },
  "users.freeze": {
    label: "Freeze / unfreeze accounts",
    category: "Users",
    minRole: "senior_moderator",
  },
  "users.forceLogoutAll": {
    label: "Force logout all sessions",
    category: "Users",
    minRole: "senior_moderator",
  },
  "users.security": {
    label: "View security activity",
    category: "Users",
    minRole: "senior_moderator",
  },
  "users.ban": { label: "Ban / unban users", category: "Users", minRole: "manager" },
  "users.ip": { label: "Block / unblock IP", category: "Users", minRole: "manager" },
  "wallet.viewBalance": { label: "View balances", category: "Wallet", minRole: "manager" },
  "wallet.adjust": { label: "Edit balance", category: "Wallet", minRole: "manager" },
  "transactions.view": { label: "View transactions", category: "Wallet", minRole: "manager" },
  "withdrawals.view": { label: "Review withdrawals", category: "Withdrawals", minRole: "manager" },
  "withdrawals.decide": {
    label: "Approve / reject withdrawals",
    category: "Withdrawals",
    minRole: "manager",
  },
  "mining.view": { label: "View mining rooms", category: "Mining", minRole: "support" },
  "mining.kick": { label: "Kick inactive miners", category: "Mining", minRole: "moderator" },
  "mining.disconnect": {
    label: "Disconnect stuck sessions",
    category: "Mining",
    minRole: "senior_moderator",
  },
  "mining.manageRooms": { label: "Manage mining rooms", category: "Mining", minRole: "manager" },
  "mining.rounds": { label: "View mining rounds", category: "Mining", minRole: "manager" },
  "mining.economy": { label: "Mining economy settings", category: "Mining", minRole: "owner" },
  "tickets.view": { label: "View tickets", category: "Support", minRole: "support" },
  "tickets.reply": { label: "Reply to tickets", category: "Support", minRole: "support" },
  "cases.escalate": { label: "Escalate cases", category: "Support", minRole: "support" },
  "moderation.history": {
    label: "View moderation history",
    category: "Support",
    minRole: "moderator",
  },
  "staff.view": { label: "View staff activity", category: "Staff", minRole: "manager" },
  "staff.manage": { label: "Manage staff", category: "Staff", minRole: "owner" },
  "roles.manage": { label: "Manage roles & permissions", category: "Staff", minRole: "owner" },
  "audit.view": { label: "View audit logs", category: "Logs", minRole: "senior_moderator" },
  "system.settings": { label: "System settings", category: "System", minRole: "owner" },
};

export type PermissionMatrix = Record<Role, Record<Permission, boolean>>;

export function defaultMatrix(): PermissionMatrix {
  const m = {} as PermissionMatrix;
  for (const r of ROLES) {
    m[r.id] = {} as Record<Permission, boolean>;
    for (const [p, def] of Object.entries(PERMISSIONS)) {
      m[r.id][p as Permission] = r.rank >= roleRank(def.minRole);
    }
  }
  return m;
}

export const PAGE_PERMISSIONS: Record<string, Permission | null> = {
  "/": null,
  "/users": "users.view",
  "/withdrawals": "withdrawals.view",
  "/transactions": "transactions.view",
  "/mining-rooms": "mining.view",
  "/mining-rounds": "mining.rounds",
  "/tickets": "tickets.view",
  "/staff": "staff.view",
  "/roles": "roles.manage",
  "/audit-logs": "audit.view",
  "/settings": "system.settings",
};
