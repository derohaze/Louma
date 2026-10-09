import type { Role } from "./permissions";

export type AccountStatus = "Active" | "Suspended" | "Frozen" | "Banned";
export type MiningStatus = "Mining" | "Idle" | "Stuck" | "Offline";

export interface User {
  id: string;
  username: string;
  email: string;
  wallet: string;
  status: AccountStatus;
  balance: number;
  miningStatus: MiningStatus;
  miningSpeed: number;
  room: string;
  connection: number;
  lastActive: string;
  registered: string;
  country: string;
  devices: { name: string; os: string; lastSeen: string; ip: string }[];
  sessions: { id: string; ip: string; location: string; started: string; active: boolean }[];
  notes: { by: string; text: string; time: string }[];
  flags: string[];
}

const names = [
  "amara.k",
  "leon_v",
  "sofia.r",
  "kenji",
  "noor.a",
  "mateo22",
  "ivy.chen",
  "omar.f",
  "zara_m",
  "felix.o",
  "yara.n",
  "dmitri",
  "hana.s",
  "lucas.b",
  "priya",
  "tobias",
  "mina.j",
  "aziz",
  "clara.w",
  "ravi.p",
  "elena",
  "samir.h",
  "june.l",
  "marco",
];
const countries = [
  "Egypt",
  "UAE",
  "Germany",
  "Japan",
  "Brazil",
  "India",
  "Kenya",
  "Spain",
  "Canada",
  "Turkey",
];
const rooms = ["Aurora", "Basalt", "Cobalt", "Dune", "Ember", "Fjord", "Granite", "Halo"];
const statuses: AccountStatus[] = [
  "Active",
  "Active",
  "Active",
  "Active",
  "Suspended",
  "Active",
  "Frozen",
  "Active",
  "Active",
  "Banned",
];
const mstat: MiningStatus[] = [
  "Mining",
  "Mining",
  "Idle",
  "Mining",
  "Offline",
  "Stuck",
  "Mining",
  "Idle",
];
const ago = ["2m ago", "8m ago", "21m ago", "1h ago", "3h ago", "5h ago", "Yesterday", "2d ago"];

const hex = (n: number) => {
  let s = "";
  let x = n * 2654435761;
  for (let i = 0; i < 8; i++) {
    x = (x * 1103515245 + 12345) >>> 0;
    s += (x % 16).toString(16);
  }
  return s;
};

export const USERS: User[] = names.map((u, i) => ({
  id: `LP-${(10420 + i * 37).toString()}`,
  username: u,
  email: `${u.replace(/[._]/g, "")}@mail.com`,
  wallet: `0x${hex(i + 3)}…${hex(i + 9).slice(0, 4)}`,
  status: statuses[i % statuses.length]!,
  balance: Math.round(((i * 7919) % 9000) + 120 + (i % 3) * 0.37 * 100) / 1,
  miningStatus: mstat[i % mstat.length]!,
  miningSpeed: Math.round((((i * 31) % 90) + 10) * 1.3),
  room: rooms[i % rooms.length]!,
  connection: 40 + ((i * 17) % 60),
  lastActive: ago[i % ago.length]!,
  registered: `2026-0${(i % 9) + 1}-${String((i % 27) + 1).padStart(2, "0")}`,
  country: countries[i % countries.length]!,
  devices: [
    {
      name: i % 2 ? "iPhone 16 Pro" : "Pixel 9",
      os: i % 2 ? "iOS 20.1" : "Android 16",
      lastSeen: ago[i % ago.length]!,
      ip: `102.44.${i}.${10 + i}`,
    },
    ...(i % 3 === 0
      ? [{ name: "MacBook Air", os: "macOS 16", lastSeen: "2d ago", ip: `41.33.${i}.2` }]
      : []),
  ],
  sessions: [
    {
      id: `S-${9100 + i}`,
      ip: `102.44.${i}.${10 + i}`,
      location: countries[i % countries.length]!,
      started: "Today, 09:12",
      active: true,
    },
    {
      id: `S-${8800 + i}`,
      ip: `41.33.${i}.2`,
      location: countries[(i + 2) % countries.length]!,
      started: "Yesterday, 22:40",
      active: i % 2 === 0,
    },
  ],
  notes:
    i % 4 === 0
      ? [
          {
            by: "Laila Hassan",
            text: "User contacted about delayed mining rewards.",
            time: "Oct 5, 14:20",
          },
        ]
      : [],
  flags:
    i % 6 === 5
      ? ["Multiple accounts suspected"]
      : i % 7 === 3
        ? ["Unusual withdrawal pattern"]
        : [],
}));

export type TxType = "Mining Reward" | "Withdrawal" | "Deposit" | "Adjustment" | "Commission";
export interface Transaction {
  id: string;
  userId: string;
  type: TxType;
  amount: number;
  currency: string;
  status: "Completed" | "Pending" | "Failed";
  date: string;
}
const txTypes: TxType[] = [
  "Mining Reward",
  "Mining Reward",
  "Withdrawal",
  "Deposit",
  "Mining Reward",
  "Commission",
  "Adjustment",
];
export const TRANSACTIONS: Transaction[] = Array.from({ length: 42 }, (_, i) => {
  const t = txTypes[i % txTypes.length]!;
  return {
    id: `TX-${70310 + i * 13}`,
    userId: USERS[i % USERS.length]!.id,
    type: t,
    amount:
      (Math.round((((i * 613) % 900) + 4.5) * 100) / 100) *
      (t === "Withdrawal" || t === "Commission" ? -1 : 1),
    currency: i % 4 === 0 ? "USDT" : "LMP",
    status: i % 11 === 4 ? "Failed" : i % 6 === 2 ? "Pending" : "Completed",
    date: `Oct ${7 - Math.floor(i / 7)}, ${String(8 + (i % 12)).padStart(2, "0")}:${String((i * 7) % 60).padStart(2, "0")}`,
  };
});

export type WithdrawalStatus =
  "Pending" | "Approved" | "Rejected" | "Processing" | "Completed" | "Flagged";
export interface Withdrawal {
  id: string;
  userId: string;
  amount: number;
  currency: string;
  wallet: string;
  date: string;
  status: WithdrawalStatus;
  reviewer: string | null;
  notes: string[];
  history: { action: string; by: string; time: string }[];
}
const wst: WithdrawalStatus[] = [
  "Pending",
  "Pending",
  "Processing",
  "Completed",
  "Pending",
  "Flagged",
  "Approved",
  "Rejected",
  "Pending",
  "Completed",
  "Pending",
  "Processing",
  "Flagged",
  "Pending",
];
export const WITHDRAWALS: Withdrawal[] = wst.map((s, i) => ({
  id: `WD-${5520 + i * 7}`,
  userId: USERS[(i * 3) % USERS.length]!.id,
  amount: Math.round((((i * 977) % 4000) + 50) * 100) / 100,
  currency: i % 3 === 0 ? "USDT" : "LMP",
  wallet: USERS[(i * 3) % USERS.length]!.wallet,
  date: `Oct ${7 - Math.floor(i / 4)}, ${String(9 + i).padStart(2, "0")}:15`,
  status: s,
  reviewer: s === "Pending" || s === "Flagged" ? null : "Omar Nabil",
  notes: s === "Flagged" ? ["Destination wallet linked to 3 other accounts."] : [],
  history: [
    { action: "Request submitted", by: "System", time: `Oct ${7 - Math.floor(i / 4)}` },
    ...(s !== "Pending"
      ? [
          {
            action: `Marked ${s}`,
            by: s === "Flagged" ? "Risk engine" : "Omar Nabil",
            time: "Oct 7",
          },
        ]
      : []),
  ],
}));

export interface MiningRoom {
  id: string;
  name: string;
  status: "Open" | "Closed" | "Degraded";
  members: string[];
  capacity: number;
  speed: number;
  round: number;
  connection: number;
  history: { round: number; reward: number; duration: string }[];
}
export const ROOMS: MiningRoom[] = rooms.map((r, i) => ({
  id: `RM-${100 + i}`,
  name: r,
  status: i === 3 ? "Closed" : i === 5 ? "Degraded" : "Open",
  members: USERS.filter((u) => u.room === r).map((u) => u.id),
  capacity: 50 + (i % 3) * 25,
  speed: 320 + i * 47,
  round: 1840 + i * 3,
  connection: i === 5 ? 48 : 78 + ((i * 3) % 20),
  history: Array.from({ length: 5 }, (_, k) => ({
    round: 1840 + i * 3 - k - 1,
    reward: 120 + (((k + i) * 13) % 40),
    duration: `${10 + ((k * 3) % 5)}m ${(k * 17) % 60}s`,
  })),
}));

export interface MiningRound {
  id: string;
  room: string;
  miners: number;
  reward: number;
  difficulty: number;
  duration: string;
  status: "Running" | "Completed" | "Failed";
  started: string;
}
export const ROUNDS: MiningRound[] = Array.from({ length: 14 }, (_, i) => ({
  id: `R-${1864 - i}`,
  room: rooms[i % rooms.length]!,
  miners: 12 + ((i * 7) % 30),
  reward: 120 + ((i * 11) % 40),
  difficulty: 4.2 + (i % 5) * 0.1,
  duration: i < 3 ? "—" : `${11 + (i % 4)}m ${(i * 13) % 60}s`,
  status: i < 3 ? "Running" : i === 7 ? "Failed" : "Completed",
  started: `Oct 7, ${String(13 - Math.floor(i / 2)).padStart(2, "0")}:${String((i * 9) % 60).padStart(2, "0")}`,
}));

export type TicketStatus = "New" | "Open" | "Waiting" | "Escalated" | "Resolved" | "Closed";
export interface Ticket {
  id: string;
  userId: string;
  subject: string;
  status: TicketStatus;
  priority: "Low" | "Medium" | "High" | "Urgent";
  assigned: string | null;
  updated: string;
  messages: { from: "user" | "staff"; name: string; text: string; time: string }[];
  notes: { by: string; text: string; time: string }[];
}
const subjects = [
  "Mining rewards not credited",
  "Can't join Aurora room",
  "Withdrawal stuck in processing",
  "Account frozen without notice",
  "Wallet address change request",
  "Mining speed dropped suddenly",
  "Login from unknown device",
  "Duplicate deposit charge",
  "How to raise mining tier?",
  "App disconnects every round",
];
const tst: TicketStatus[] = [
  "New",
  "Open",
  "Waiting",
  "Escalated",
  "Open",
  "New",
  "Escalated",
  "Resolved",
  "Closed",
  "Open",
];
const prio = [
  "High",
  "Medium",
  "Urgent",
  "High",
  "Low",
  "Medium",
  "Urgent",
  "Low",
  "Low",
  "Medium",
] as const;
export const TICKETS: Ticket[] = subjects.map((s, i) => ({
  id: `TK-${3301 + i}`,
  userId: USERS[(i * 5) % USERS.length]!.id,
  subject: s,
  status: tst[i]!,
  priority: prio[i]!,
  assigned: i % 3 === 0 ? null : i % 2 ? "Laila Hassan" : "Youssef Adel",
  updated: ago[i % ago.length]!,
  messages: [
    {
      from: "user",
      name: USERS[(i * 5) % USERS.length]!.username,
      text: `Hi, ${s.toLowerCase()}. Can you help me check what is going on?`,
      time: "Today, 09:41",
    },
    ...(i % 2
      ? [
          {
            from: "staff" as const,
            name: "Laila Hassan",
            text: "Thanks for reaching out — I'm looking into your account now.",
            time: "Today, 09:55",
          },
        ]
      : []),
  ],
  notes:
    i === 3
      ? [
          {
            by: "Youssef Adel",
            text: "Freeze triggered by risk engine. Needs senior review.",
            time: "Today, 10:02",
          },
        ]
      : [],
}));

export interface Staff {
  id: string;
  name: string;
  email: string;
  role: Role;
  status: "Active" | "Suspended" | "Offline";
  lastLogin: string;
  sessions: number;
}
export const STAFF: Staff[] = [
  {
    id: "ST-01",
    name: "Nadia Farouk",
    email: "nadia@loumapay.com",
    role: "owner",
    status: "Active",
    lastLogin: "Just now",
    sessions: 2,
  },
  {
    id: "ST-02",
    name: "Omar Nabil",
    email: "omar@loumapay.com",
    role: "manager",
    status: "Active",
    lastLogin: "12m ago",
    sessions: 1,
  },
  {
    id: "ST-03",
    name: "Reem Salah",
    email: "reem@loumapay.com",
    role: "manager",
    status: "Offline",
    lastLogin: "Yesterday",
    sessions: 0,
  },
  {
    id: "ST-04",
    name: "Karim Mostafa",
    email: "karim@loumapay.com",
    role: "senior_moderator",
    status: "Active",
    lastLogin: "40m ago",
    sessions: 1,
  },
  {
    id: "ST-05",
    name: "Salma Tarek",
    email: "salma@loumapay.com",
    role: "moderator",
    status: "Active",
    lastLogin: "5m ago",
    sessions: 2,
  },
  {
    id: "ST-06",
    name: "Hassan Ali",
    email: "hassan@loumapay.com",
    role: "moderator",
    status: "Suspended",
    lastLogin: "6d ago",
    sessions: 0,
  },
  {
    id: "ST-07",
    name: "Laila Hassan",
    email: "laila@loumapay.com",
    role: "support",
    status: "Active",
    lastLogin: "2m ago",
    sessions: 1,
  },
  {
    id: "ST-08",
    name: "Youssef Adel",
    email: "youssef@loumapay.com",
    role: "support",
    status: "Active",
    lastLogin: "18m ago",
    sessions: 1,
  },
  {
    id: "ST-09",
    name: "Mona Gamal",
    email: "mona@loumapay.com",
    role: "support",
    status: "Offline",
    lastLogin: "3h ago",
    sessions: 0,
  },
];

export interface AuditEntry {
  id: string;
  time: string;
  staff: string;
  role: Role;
  action: string;
  target: string;
  reason: string;
  status: "Success" | "Failed" | "Pending";
}
export const AUDIT: AuditEntry[] = [
  {
    id: "A-1",
    time: "Oct 7, 12:58",
    staff: "Omar Nabil",
    role: "manager",
    action: "Approved withdrawal",
    target: "WD-5541",
    reason: "Verified KYC and wallet",
    status: "Success",
  },
  {
    id: "A-2",
    time: "Oct 7, 12:31",
    staff: "Salma Tarek",
    role: "moderator",
    action: "Kicked miner",
    target: "LP-10642 · Aurora",
    reason: "Inactive 45 min",
    status: "Success",
  },
  {
    id: "A-3",
    time: "Oct 7, 11:47",
    staff: "Karim Mostafa",
    role: "senior_moderator",
    action: "Froze account",
    target: "LP-10642",
    reason: "Suspicious login pattern",
    status: "Success",
  },
  {
    id: "A-4",
    time: "Oct 7, 10:20",
    staff: "Nadia Farouk",
    role: "owner",
    action: "Changed staff role",
    target: "Salma Tarek → Moderator",
    reason: "Promotion",
    status: "Success",
  },
  {
    id: "A-5",
    time: "Oct 7, 09:42",
    staff: "Omar Nabil",
    role: "manager",
    action: "Adjusted balance",
    target: "LP-10531 · +40 LMP",
    reason: "Ticket TK-3298 compensation",
    status: "Success",
  },
  {
    id: "A-6",
    time: "Oct 7, 09:10",
    staff: "Laila Hassan",
    role: "support",
    action: "Escalated ticket",
    target: "TK-3304",
    reason: "Account freeze dispute",
    status: "Pending",
  },
  {
    id: "A-7",
    time: "Oct 6, 22:15",
    staff: "Reem Salah",
    role: "manager",
    action: "Closed mining room",
    target: "Dune",
    reason: "Scheduled maintenance",
    status: "Success",
  },
  {
    id: "A-8",
    time: "Oct 6, 19:03",
    staff: "Karim Mostafa",
    role: "senior_moderator",
    action: "Forced logout all sessions",
    target: "LP-10753",
    reason: "Compromised device",
    status: "Success",
  },
  {
    id: "A-9",
    time: "Oct 6, 17:40",
    staff: "Omar Nabil",
    role: "manager",
    action: "Rejected withdrawal",
    target: "WD-5569",
    reason: "Destination flagged",
    status: "Success",
  },
  {
    id: "A-10",
    time: "Oct 6, 15:22",
    staff: "Salma Tarek",
    role: "moderator",
    action: "Suspended user",
    target: "LP-10568",
    reason: "Spam in support",
    status: "Failed",
  },
];

export const NOTIFICATIONS = [
  {
    id: "n1",
    title: "3 withdrawals flagged by risk engine",
    time: "4m ago",
    tone: "warning" as const,
  },
  { id: "n2", title: "Fjord room connection degraded", time: "18m ago", tone: "danger" as const },
  { id: "n3", title: "Ticket TK-3304 escalated to you", time: "1h ago", tone: "info" as const },
  { id: "n4", title: "Round R-1861 completed · 152 LMP", time: "2h ago", tone: "success" as const },
];
