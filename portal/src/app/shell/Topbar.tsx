import { useRouterState } from "@tanstack/react-router";
import { Bell, Check, ChevronDown, ChevronRight } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/shared/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/shared/ui/popover";
import { NOTIFICATIONS } from "@/shared/lib/mock-data";
import { ROLES } from "@/shared/lib/permissions";
import { useStaff } from "@/shared/lib/staff-store";
import { cn } from "@/shared/lib/utils";
import { RoleBadge } from "@/shared/components/primitives";
import { ALL_NAV_ITEMS, NAV } from "./nav";

function RoleSwitcher() {
  const { role, setRole } = useStaff();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="flex h-10 items-center gap-2 rounded-xl border bg-card px-3 text-sm font-medium shadow-[var(--shadow-soft)] transition hover:border-primary/40">
        <span className="text-muted-foreground">View as</span>
        <RoleBadge role={role} />
        <ChevronDown className="size-4 text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72 rounded-2xl p-2">
        <DropdownMenuLabel className="text-xs text-muted-foreground">
          Preview the console as
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {[...ROLES].reverse().map((r) => (
          <DropdownMenuItem
            key={r.id}
            onClick={() => setRole(r.id)}
            className="flex items-start gap-3 rounded-xl px-3 py-2.5"
          >
            <span className="mt-0.5 font-mono text-xs text-muted-foreground">L{r.rank}</span>
            <div className="flex-1">
              <div className="text-sm font-semibold">{r.label}</div>
              <div className="text-xs text-muted-foreground">{r.summary}</div>
            </div>
            {role === r.id && <Check className="size-4 text-primary" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

const NOTIFICATION_TONE = {
  warning: "bg-warning",
  danger: "bg-destructive",
  info: "bg-info",
  success: "bg-success",
} as const;

function NotificationPanel() {
  return (
    <Popover>
      <PopoverTrigger className="relative flex size-10 items-center justify-center rounded-xl border bg-card shadow-[var(--shadow-soft)] transition hover:border-primary/40">
        <Bell className="size-[18px]" />
        <span className="absolute right-2 top-2 size-2 rounded-full bg-primary ring-2 ring-card" />
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 rounded-2xl p-2">
        <div className="px-3 py-2 text-sm font-semibold">Notifications</div>
        {NOTIFICATIONS.map((n) => (
          <div key={n.id} className="flex gap-3 rounded-xl px-3 py-2.5 transition hover:bg-muted">
            <span
              className={cn("mt-1.5 size-2 shrink-0 rounded-full", NOTIFICATION_TONE[n.tone])}
            />
            <div>
              <div className="text-sm">{n.title}</div>
              <div className="text-xs text-muted-foreground">{n.time}</div>
            </div>
          </div>
        ))}
      </PopoverContent>
    </Popover>
  );
}

/**
 * Breadcrumb + console controls. Sticky on the flat page background with a
 * hairline underneath, so it stays readable while content scrolls past it.
 */
export function Topbar() {
  const path = useRouterState({ select: (s) => s.location.pathname });
  const base = "/" + (path.split("/")[1] ?? "");
  const current = ALL_NAV_ITEMS.find((i) => i.to === base) ?? ALL_NAV_ITEMS[0]!;
  const group = NAV.find((g) => g.items.some((i) => i.to === current.to))?.group;
  const sub = path.split("/")[2];

  return (
    <header className="flex h-16 items-center gap-4 px-2">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <current.icon className="size-4" />
        <span>{group}</span>
        <ChevronRight className="size-3.5" />
        <span className={cn(!sub && "font-medium text-foreground")}>{current.label}</span>
        {sub && (
          <>
            <ChevronRight className="size-3.5" />
            <span className="font-mono font-medium text-foreground">{sub}</span>
          </>
        )}
      </div>
      <div className="ml-auto flex items-center gap-2">
        <RoleSwitcher />
        <NotificationPanel />
      </div>
    </header>
  );
}
