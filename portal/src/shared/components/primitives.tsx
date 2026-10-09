import type { ReactNode } from "react";
import { Search, ShieldOff, TrendingUp, TrendingDown } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { cn } from "@/shared/lib/utils";
import { roleLabel, type Permission, type Role } from "@/shared/lib/permissions";
import { useStaff } from "@/shared/lib/staff-store";

type Tone = "success" | "warning" | "danger" | "info" | "primary" | "neutral";
const toneCls: Record<Tone, string> = {
  success: "bg-success-soft text-success",
  warning: "bg-warning-soft text-warning",
  danger: "bg-danger-soft text-destructive",
  info: "bg-info-soft text-info",
  primary: "bg-primary-soft text-primary",
  neutral: "bg-muted text-muted-foreground",
};
const dotCls: Record<Tone, string> = {
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-destructive",
  info: "bg-info",
  primary: "bg-primary",
  neutral: "bg-muted-foreground",
};

const STATUS_TONE: Record<string, Tone> = {
  Active: "success",
  Mining: "success",
  Open: "info",
  Completed: "success",
  Approved: "success",
  Resolved: "success",
  Success: "success",
  Running: "primary",
  Pending: "warning",
  Waiting: "warning",
  Idle: "neutral",
  Processing: "info",
  New: "primary",
  Degraded: "warning",
  Suspended: "warning",
  Frozen: "info",
  Banned: "danger",
  Rejected: "danger",
  Failed: "danger",
  Flagged: "danger",
  Escalated: "danger",
  Stuck: "danger",
  Offline: "neutral",
  Closed: "neutral",
  Low: "neutral",
  Medium: "info",
  High: "warning",
  Urgent: "danger",
};

export function StatusBadge({ status, tone }: { status: string; tone?: Tone }) {
  const t = tone ?? STATUS_TONE[status] ?? "neutral";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold",
        toneCls[t],
      )}
    >
      <span className={cn("size-1.5 rounded-full", dotCls[t])} />
      {status}
    </span>
  );
}

const ROLE_TONE: Record<Role, string> = {
  support: "bg-muted text-muted-foreground",
  moderator: "bg-info-soft text-info",
  senior_moderator: "bg-warning-soft text-warning",
  manager: "bg-primary-soft text-primary",
  owner: "bg-ink text-ink-foreground",
};
export function RoleBadge({ role }: { role: Role }) {
  return (
    <span
      className={cn(
        "inline-flex rounded-md px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide",
        ROLE_TONE[role],
      )}
    >
      {roleLabel(role)}
    </span>
  );
}

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-[26px] font-semibold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

/** Segmented meter inspired by progress tick bars. */
export function SegmentMeter({
  value,
  max = 100,
  segments = 18,
  tone = "primary",
}: {
  value: number;
  max?: number;
  segments?: number;
  tone?: Tone;
}) {
  const filled = Math.round((value / max) * segments);
  return (
    <div className="flex gap-[3px]">
      {Array.from({ length: segments }, (_, i) => (
        <span
          key={i}
          className={cn("h-4 w-[5px] rounded-full", i < filled ? dotCls[tone] : "bg-border")}
        />
      ))}
    </div>
  );
}

export function MetricCard({
  label,
  value,
  delta,
  icon,
  meter,
  tone = "primary",
}: {
  label: string;
  value: ReactNode;
  delta?: number;
  icon?: ReactNode;
  meter?: number;
  tone?: Tone;
}) {
  return (
    <div className="surface lift p-5">
      <div className="flex items-center justify-between">
        <span
          className={cn(
            "inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold",
            toneCls[tone],
          )}
        >
          {icon}
          {label}
        </span>
      </div>
      <div className="mt-4 flex items-baseline gap-2">
        <span className="font-mono text-[28px] font-medium tracking-tight">{value}</span>
        {delta !== undefined && (
          <span
            className={cn(
              "inline-flex items-center gap-0.5 text-xs font-semibold",
              delta >= 0 ? "text-success" : "text-destructive",
            )}
          >
            {delta >= 0 ? (
              <TrendingUp className="size-3.5" />
            ) : (
              <TrendingDown className="size-3.5" />
            )}
            {delta > 0 ? "+" : ""}
            {delta}%
          </span>
        )}
      </div>
      {meter !== undefined && (
        <div className="mt-3">
          <SegmentMeter value={meter} tone={tone} />
        </div>
      )}
    </div>
  );
}

export function SearchInput({
  value,
  onChange,
  placeholder = "Search…",
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string;
}) {
  return (
    <label
      className={cn(
        "flex h-10 items-center gap-2 rounded-xl border bg-card px-3 text-sm transition focus-within:border-primary focus-within:ring-4 focus-within:ring-primary-soft",
        className,
      )}
    >
      <Search className="size-4 text-muted-foreground" />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full bg-transparent outline-none placeholder:text-muted-foreground"
      />
    </label>
  );
}

export function FilterBar({ children }: { children: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-center gap-2 rounded-2xl border bg-card p-2 shadow-[var(--shadow-soft)]">
      {children}
    </div>
  );
}

export function Chip({
  active,
  onClick,
  children,
}: {
  active?: boolean;
  onClick?: () => void;
  children: ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "h-8 rounded-lg px-3 text-xs font-semibold transition",
        active
          ? "bg-primary text-primary-foreground"
          : "text-muted-foreground hover:bg-muted hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

export interface Column<T> {
  key: string;
  header: string;
  cell: (row: T) => ReactNode;
  className?: string;
}
export function DataTable<T>({
  columns,
  rows,
  rowKey,
  onRowClick,
  empty = "No results",
}: {
  columns: Column<T>[];
  rows: T[];
  rowKey: (r: T) => string;
  onRowClick?: (r: T) => void;
  empty?: string;
}) {
  return (
    <div className="surface overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/60">
              {columns.map((c) => (
                <th
                  key={c.key}
                  className={cn(
                    "whitespace-nowrap px-4 py-3 text-left text-xs font-semibold text-muted-foreground",
                    c.className,
                  )}
                >
                  {c.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr
                key={rowKey(r)}
                onClick={onRowClick ? () => onRowClick(r) : undefined}
                className={cn(
                  "border-b last:border-0 transition-colors",
                  onRowClick && "cursor-pointer hover:bg-primary-soft/40",
                )}
              >
                {columns.map((c) => (
                  <td key={c.key} className={cn("whitespace-nowrap px-4 py-3", c.className)}>
                    {c.cell(r)}
                  </td>
                ))}
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td
                  colSpan={columns.length}
                  className="px-4 py-12 text-center text-muted-foreground"
                >
                  {empty}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function Avatar({ name, size = 32 }: { name: string; size?: number }) {
  const initials = name
    .replace(/[^a-zA-Z ]/g, " ")
    .trim()
    .split(/\s+/)
    .map((s) => s[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
  return (
    <span
      style={{ width: size, height: size }}
      className="inline-flex shrink-0 items-center justify-center rounded-full bg-primary-soft text-[11px] font-bold text-primary ring-2 ring-card"
    >
      {initials}
    </span>
  );
}

export function Mono({ children }: { children: ReactNode }) {
  return <span className="font-mono text-[12.5px] text-muted-foreground">{children}</span>;
}

export function Panel({
  title,
  action,
  children,
  className,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("surface p-5", className)}>
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-[15px] font-semibold">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}

export function KV({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <dl className="surface-inset divide-y divide-border/70 px-4">
      {rows.map(([k, v]) => (
        <div key={k} className="flex items-center justify-between gap-4 py-2.5 text-sm">
          <dt className="text-muted-foreground">{k}</dt>
          <dd className="text-right font-medium">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Guard({ perm, children }: { perm: Permission; children: ReactNode }) {
  const { can, role } = useStaff();
  if (can(perm)) return <>{children}</>;
  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <div className="surface max-w-md p-10 text-center">
        <span className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-danger-soft text-destructive">
          <ShieldOff className="size-6" />
        </span>
        <h1 className="mt-5 text-xl font-semibold">Access Restricted</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Your current role doesn't have permission to view this page.
        </p>
        <div className="mt-4 flex items-center justify-center gap-2 text-sm">
          Signed in as <RoleBadge role={role} />
        </div>
        <Link
          to="/"
          className="mt-6 inline-flex h-10 items-center rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground transition hover:opacity-90"
        >
          Back to dashboard
        </Link>
      </div>
    </div>
  );
}
