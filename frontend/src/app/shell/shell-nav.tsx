import { Link } from "@tanstack/react-router";
import { Menu01Icon } from "@hugeicons/core-free-icons";
import { Icon } from "@/shared/ui/page";
import { translate, useT } from "@/shared/i18n";
import { cn } from "@/shared/lib/platform";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/shared/ui/dialog";
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
  useT("nav");
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
      <span className="max-w-[64px] text-center leading-4 text-balance">
        {translate(section.titleKey)}
      </span>
    </Link>
  );
}

/**
 * Section navigation panel. `scope="section"` shows only the section the route belongs to (the
 * desktop panel next to the rail); `scope="all"` shows every section (the mobile More sheet, where
 * the rail that switches sections is not rendered) and labels each group, because without the rail
 * a group heading is the only thing telling one section's pages from the next.
 */
export function SidebarNav({
  pathname,
  scope,
  onNavigate,
  className = "w-[228px]",
}: {
  pathname: string;
  scope: "section" | "all";
  onNavigate: () => void;
  /** Width/layout of the panel. The desktop panel takes its own column; the sheet fills the sheet. */
  className?: string;
}) {
  useT("nav");
  const activeSection = findActiveSection(pathname);
  const sections = scope === "all" || !activeSection ? navSections : [activeSection];
  return (
    <aside
      className={cn(
        "h-full shrink-0 overflow-x-hidden overflow-y-auto bg-[#E9E9EC] px-3 py-4 dark:bg-card",
        className,
      )}
    >
      <nav>
        {sections.map((section) => (
          <div key={section.titleKey} className="mb-1">
            {scope === "all" && (
              <p className="px-3 pb-1 pt-3 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
                {translate(section.titleKey)}
              </p>
            )}
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
                    "mb-1 flex h-11 w-full items-center gap-2.5 rounded-xl px-3 text-sm font-semibold transition-all duration-500 ease-[cubic-bezier(0.4,0,0.2,1)]",
                    "translate-y-0 opacity-100",
                    current
                      ? "bg-card text-[#323234] shadow-sm dark:bg-secondary dark:text-white"
                      : "text-[#58585E] hover:bg-card/70 hover:text-[#323234] dark:text-zinc-400 dark:hover:bg-white/10 dark:hover:text-white",
                  )}
                >
                  <Icon icon={item.icon} size={21} />
                  <span>{translate(item.titleKey)}</span>
                </Link>
              );
            })}
          </div>
        ))}
      </nav>
    </aside>
  );
}

/**
 * The sections a phone navigates between all day. The account-level sections are deliberately not
 * here: they belong to the account menu, and the rest of the pages live one tap away behind More.
 */
const tabSections = navSections.filter((section) => !section.accountLevel).slice(0, 4);

/**
 * The phone's navigation, instead of the desktop rail plus panel: five slots, four of them the
 * everyday wallet sections and the last one the way to everything else.
 *
 * It is a fixed bar, not a drawer, so no page is ever hidden behind a menu that has to be opened
 * first — the section a customer is in is always one tap from the others. The header's hamburger
 * is gone with it: the whole point of the bar is that there is no drawer left to open.
 */
export function MobileTabBar({
  pathname,
  moreOpen,
  onOpenMore,
}: {
  pathname: string;
  moreOpen: boolean;
  onOpenMore: () => void;
}) {
  const t = useT("nav");
  const activeSection = findActiveSection(pathname);
  const tw = (current: boolean) =>
    cn(
      "flex h-16 flex-col items-center justify-center gap-1 text-[10px] font-semibold transition-colors",
      current ? "text-primary" : "text-muted-foreground hover:text-foreground",
    );
  return (
    <nav
      aria-label={t("chrome.primaryNav")}
      className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-card pb-[env(safe-area-inset-bottom)] lg:hidden"
    >
      <div className="grid grid-cols-5">
        {tabSections.map((section) => {
          const current = section.titleKey === activeSection?.titleKey;
          return (
            <Link
              key={section.titleKey}
              to={section.items[0].href}
              aria-current={current ? "page" : undefined}
              className={tw(current)}
            >
              <Icon icon={section.icon} size={22} />
              <span>{translate(section.titleKey)}</span>
            </Link>
          );
        })}
        <button
          type="button"
          onClick={onOpenMore}
          aria-expanded={moreOpen}
          className={tw(moreActive(activeSection))}
        >
          <Icon icon={Menu01Icon} size={22} />
          <span>{t("chrome.more")}</span>
        </button>
      </div>
    </nav>
  );
}

/**
 * More lights up whenever the route is not one of the four bar sections — including the
 * account-level pages and any page outside the navigation (a single transaction, the notifications
 * page) — because opening the sheet is then the only way to reach another section.
 */
function moreActive(activeSection: NavSection | undefined): boolean {
  return !tabSections.some((section) => section.titleKey === activeSection?.titleKey);
}

/**
 * The sheet behind More: every section and every page, in the same groups the sidebar uses, plus
 * the account-level pages the bar leaves out. It is a bottom sheet rather than the floating drawer
 * it replaces — the drawer sat on top of the page with a shadow anyone could see the page through,
 * which read as an overlay that had not finished loading.
 */
export function MobileMoreSheet({
  open,
  onOpenChange,
  pathname,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pathname: string;
}) {
  const t = useT("nav");
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={cn(
          "bottom-0 left-0 right-0 top-auto z-50 flex max-h-[86dvh] w-full max-w-none translate-x-0 translate-y-0 flex-col",
          "gap-0 rounded-none rounded-t-[26px] border-0 bg-[#F5F5F6] p-0 pb-[env(safe-area-inset-bottom)] shadow-2xl dark:bg-background",
          "lg:hidden",
        )}
      >
        <div className="border-b px-5 py-4 pe-12">
          <DialogTitle className="font-display text-lg font-bold">
            {t("chrome.allPages")}
          </DialogTitle>
          <DialogDescription className="sr-only">
            {t("chrome.allPagesDescription")}
          </DialogDescription>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3">
          {/*
           * The sheet is the only scroller: the panel gives up its own width, height, and
           * background so the rows sit directly on the sheet instead of inside a second scroll box.
           */}
          <SidebarNav
            pathname={pathname}
            scope="all"
            onNavigate={() => onOpenChange(false)}
            className="h-auto w-full bg-transparent dark:bg-transparent"
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}
