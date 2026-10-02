import { Link } from "@tanstack/react-router";
import { Icon } from "@/shared/ui/page";
import { cn } from "@/shared/lib/platform";
import {
  findActiveSection,
  navItems,
  navSections,
  type NavHref,
  type NavSection,
} from "@/shared/lib/wallet";

/** Flat position of every page, so the staggered entrance follows the visible order. */
const navOrder = new Map<NavHref, number>(navItems.map((item, index) => [item.href, index]));

/**
 * Compact rail item: the rail lists sections, and the panel below shows the pages of the one
 * the route belongs to. Clicking a section opens its landing page.
 *
 * Layout follows Hostinger's own rail: the icon sits plainly in the middle of the column with
 * the label centred underneath it. There is deliberately no chip behind the icon — the
 * reference carries no box on its current item either, so the current section is marked by
 * colour alone (bright icon and label against the muted rest). The icon is drawn at 22px
 * rather than 20px because that is what the reference uses, and at 20px inside a 72px column
 * it read as a detail next to the label rather than the anchor of the item.
 */
export function RailLink({ section, current }: { section: NavSection; current: boolean }) {
  return (
    <Link
      to={section.items[0].href}
      aria-current={current ? "page" : undefined}
      className={cn(
        "group flex min-h-[68px] flex-col items-center justify-center gap-2 px-1 text-[11px] font-medium",
        current
          ? "text-[#323234] dark:text-white"
          : "text-[#58585E] hover:text-[#323234] dark:text-zinc-400 dark:hover:text-white",
      )}
    >
      <Icon icon={section.icon} size={22} className="shrink-0" />
      <span className="max-w-[64px] text-center leading-4 text-balance">{section.title}</span>
    </Link>
  );
}

/**
 * Section navigation panel. `scope="section"` shows only the section the route belongs to (the
 * desktop panel next to the rail); `scope="all"` shows every section (the mobile drawer, where
 * the rail that switches sections is not rendered).
 */
export function SidebarNav({
  pathname,
  scope,
  onNavigate,
}: {
  pathname: string;
  scope: "section" | "all";
  onNavigate: () => void;
}) {
  const activeSection = findActiveSection(pathname);
  const sections = scope === "all" || !activeSection ? navSections : [activeSection];
  return (
    <aside className="h-full w-[228px] shrink-0 overflow-x-hidden overflow-y-auto bg-[#E9E9EC] px-3 py-4 dark:bg-card">
      <nav>
        {sections.map((section) => (
          <div key={section.title} className="mb-1">
            {section.items.map((item) => {
              const current = pathname === item.href;
              return (
                <Link
                  key={item.href}
                  to={item.href}
                  onClick={onNavigate}
                  aria-current={current ? "page" : undefined}
                  style={{ transitionDelay: `${(navOrder.get(item.href) ?? 0) * 60}ms` }}
                  className={cn(
                    "mb-1 flex h-10 w-full items-center gap-2.5 rounded-xl px-3 text-sm font-semibold transition-all duration-500 ease-[cubic-bezier(0.4,0,0.2,1)]",
                    "translate-y-0 opacity-100",
                    current
                      ? "bg-card text-[#323234] shadow-sm dark:bg-secondary dark:text-white"
                      : "text-[#58585E] hover:bg-card/70 hover:text-[#323234] dark:text-zinc-400 dark:hover:bg-white/10 dark:hover:text-white",
                  )}
                >
                  <Icon icon={item.icon} size={21} />
                  <span>{item.title}</span>
                </Link>
              );
            })}
          </div>
        ))}
      </nav>
    </aside>
  );
}
