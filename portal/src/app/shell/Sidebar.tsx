import { useState, type ReactNode } from "react";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { ChevronUp, Command, KeyRound, LogOut, Settings2 } from "lucide-react";
import { PAGE_PERMISSIONS } from "@/shared/lib/permissions";
import { useStaff } from "@/shared/lib/staff-store";
import { cn } from "@/shared/lib/utils";
import { Avatar, RoleBadge } from "@/shared/components/primitives";
import { NAV } from "./nav";

/**
 * Full-height sidebar, flush to the viewport edge. It sits on the same flat
 * page background as everything else — it is not a card, so it has no
 * rounding, no outer margin, and no shadow. The active page is the only
 * raised element (a white pill).
 */
/**
 * One staggered menu row: rises into place with a per-index delay while the
 * panel opens, so entries cascade instead of popping in together.
 */
function MenuRow({ index, open, children }: { index: number; open: boolean; children: ReactNode }) {
  return (
    <div
      style={{ transitionDelay: open ? `${index * 75}ms` : "0ms" }}
      className={cn(
        "transition-all duration-500 ease-[cubic-bezier(0.4,0,0.2,1)] motion-reduce:transition-none",
        open ? "translate-y-0 opacity-100" : "translate-y-4 opacity-0",
      )}
    >
      {children}
    </div>
  );
}

export function Sidebar() {
  const { can, me, role, signOut } = useStaff();
  const [menuOpen, setMenuOpen] = useState(false);
  const navigate = useNavigate();
  const path = useRouterState({ select: (s) => s.location.pathname });

  return (
    <aside className="flex w-[248px] shrink-0 flex-col px-4 py-6">
      <div className="mb-8 flex items-center gap-3 px-2">
        <span className="flex size-9 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-[var(--shadow-float)]">
          <Command className="size-[18px]" />
        </span>
        <div className="leading-tight">
          <div className="text-[17px] font-semibold tracking-tight">Louma Pay</div>
          <div className="text-[11px] font-medium text-muted-foreground">Staff Console</div>
        </div>
      </div>

      <nav aria-label="Console sections" className="flex-1 space-y-5 overflow-y-auto">
        {NAV.map((section) => {
          const items = section.items.filter((item) => {
            const perm = PAGE_PERMISSIONS[item.to];
            return !perm || can(perm);
          });
          if (!items.length) return null;
          return (
            <div key={section.group}>
              <div className="mb-1.5 px-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/80">
                {section.group}
              </div>
              <div className="space-y-0.5">
                {items.map((item) => {
                  const active = item.to === "/" ? path === "/" : path.startsWith(item.to);
                  return (
                    <Link
                      key={item.to}
                      to={item.to as "/"}
                      aria-current={active ? "page" : undefined}
                      className={cn("nav-item", active && "nav-item-active")}
                    >
                      <item.icon className={cn("size-[17px]", active && "text-primary")} />
                      {item.label}
                      {active && <span className="ml-auto size-1.5 rounded-full bg-primary" />}
                    </Link>
                  );
                })}
              </div>
            </div>
          );
        })}
      </nav>

      {/*
       * Account block pinned to the sidebar bottom: the menu panel expands
       * directly above the frameless profile button, so it reads as part of
       * the profile instead of a floating overlay. Premium motion: the panel
       * grows 0fr -> 1fr while each row rises in with a stagger.
       */}
      <div className="mt-4" onKeyDown={(e) => e.key === "Escape" && setMenuOpen(false)}>
        <div
          className={cn(
            "grid transition-all duration-500 ease-[cubic-bezier(0.4,0,0.2,1)] motion-reduce:transition-none",
            menuOpen ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
          )}
        >
          <div className="overflow-hidden">
            <div
              id="sidebar-account-menu"
              role="menu"
              aria-label={`Account menu for ${me.name}`}
              inert={!menuOpen}
              className="mb-1 rounded-2xl border bg-card p-2 shadow-[var(--shadow-float)]"
            >
              <MenuRow index={0} open={menuOpen}>
                <div className="flex items-center gap-3 px-2 py-2">
                  <Avatar name={me.name} size={36} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold">{me.name}</span>
                    <span className="block truncate text-xs text-muted-foreground">{me.email}</span>
                  </span>
                  <RoleBadge role={role} />
                </div>
              </MenuRow>
              <div role="separator" className="mx-2 my-1 h-px bg-border" />
              <MenuRow index={1} open={menuOpen}>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setMenuOpen(false);
                    void navigate({ to: "/settings" });
                  }}
                  className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-start text-sm font-medium transition hover:bg-muted"
                >
                  <Settings2 className="size-[18px] shrink-0 text-muted-foreground" />
                  System settings
                </button>
              </MenuRow>
              <MenuRow index={2} open={menuOpen}>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setMenuOpen(false);
                    void navigate({ to: "/roles" });
                  }}
                  className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-start text-sm font-medium transition hover:bg-muted"
                >
                  <KeyRound className="size-[18px] shrink-0 text-muted-foreground" />
                  Roles & permissions
                </button>
              </MenuRow>
              <div role="separator" className="mx-2 my-1 h-px bg-border" />
              <MenuRow index={3} open={menuOpen}>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setMenuOpen(false);
                    signOut();
                    void navigate({ to: "/", replace: true });
                  }}
                  className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-start text-sm font-medium text-destructive transition hover:bg-destructive/10"
                >
                  <LogOut className="size-[18px] shrink-0" />
                  Sign out
                </button>
              </MenuRow>
            </div>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setMenuOpen((open) => !open)}
          aria-expanded={menuOpen}
          aria-controls="sidebar-account-menu"
          aria-label={`Account menu for ${me.name}`}
          className="flex w-full items-center gap-3 rounded-xl px-2 py-2 text-start transition hover:bg-card"
        >
          <Avatar name={me.name} size={36} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-semibold">{me.name}</span>
            <span className="block truncate text-xs text-muted-foreground">{me.email}</span>
          </span>
          <ChevronUp
            className={cn(
              "size-4 shrink-0 text-muted-foreground transition-transform duration-300 motion-reduce:transition-none",
              menuOpen && "rotate-180",
            )}
          />
        </button>
      </div>
    </aside>
  );
}
