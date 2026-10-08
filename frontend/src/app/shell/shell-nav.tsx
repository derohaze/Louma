import { useProAccess } from "@/shared/hooks";
import { Link } from "@tanstack/react-router";
import { LockIcon, Menu01Icon } from "@hugeicons/core-free-icons";
import { Icon } from "@/shared/ui/page";
import { translate, useT } from "@/shared/i18n";
import { cn } from "@/shared/lib/platform";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/shared/ui/dialog";
import { findActiveSection, navSections, type NavSection } from "@/shared/lib/wallet";

/**
 * Compact rail item: the rail lists sections, and the panel below shows the pages of the one
 * the route belongs to. Clicking a section opens its landing page.
 *
 * Only the active icon gets a static surface; its label stays directly on the rail.
 */
export function RailLink({ section, current }: { section: NavSection; current: boolean }) {
  useT("nav");
  return (
    <Link
      to={section.items[0].href}
      aria-current={current ? "page" : undefined}
      className={cn(
        "group mx-1 flex min-h-[68px] flex-col items-center justify-center gap-1 rounded-xl px-1 text-[11px] font-medium",
        current
          ? "text-[#323234] dark:text-white"
          : "text-[#58585E] hover:text-[#323234] dark:text-zinc-400 dark:hover:text-white",
      )}
    >
      <span
        className={cn(
          "grid size-10 place-items-center rounded-xl",
          current && "bg-card shadow-md dark:bg-secondary",
        )}
      >
        <Icon icon={section.icon} size={22} className="shrink-0" />
      </span>
      <span className="max-w-[64px] text-center leading-4 text-balance">
        {translate(section.titleKey)}
      </span>
    </Link>
  );
}

const railSections = navSections.filter(
  (section) => !section.accountLevel && section.titleKey !== "nav.sections.billing",
);

/** Renders the section links with an immediate active state. */
export function PrimaryRail({ activeSection }: { activeSection: NavSection | undefined }) {
  return (
    <div className="flex h-full flex-col">
      {railSections.map((section) => (
        <RailLink
          key={section.titleKey}
          section={section}
          current={section.titleKey === activeSection?.titleKey}
        />
      ))}
    </div>
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
  const t = useT("nav");
  const pro = useProAccess();
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
              const proFeature = item.href === "/custom-address";
              const locked = proFeature && !pro;
              const current = pathname === item.href && !locked;
              const rowClassName = cn(
                "mb-1 flex h-11 w-full items-center rounded-xl text-sm font-semibold",
                proFeature ? "gap-2 px-2" : "gap-2.5 px-3",
                locked
                  ? "cursor-not-allowed text-muted-foreground"
                  : current
                    ? "bg-card text-[#323234] shadow-sm dark:bg-secondary dark:text-white"
                    : "text-[#58585E] hover:text-[#323234] dark:text-zinc-400 dark:hover:text-white",
              );
              const rowContent = (
                <>
                  <Icon icon={item.icon} size={proFeature ? 19 : 21} className="shrink-0" />
                  <span
                    className={cn(
                      "min-w-0 flex-1",
                      proFeature ? "whitespace-nowrap text-[13px]" : "truncate",
                    )}
                  >
                    {translate(item.titleKey)}
                  </span>
                  {proFeature && (
                    <span
                      dir="ltr"
                      className="inline-flex h-6 shrink-0 items-center justify-center gap-1 rounded-full bg-primary/10 px-2 text-[10px] font-bold leading-none text-primary"
                    >
                      {t("chrome.pro")}
                      {locked && (
                        <span aria-hidden="true" className="inline-flex items-center">
                          <Icon icon={LockIcon} size={11} />
                        </span>
                      )}
                    </span>
                  )}
                </>
              );
              if (locked) {
                return (
                  <button
                    key={item.href}
                    type="button"
                    disabled
                    aria-disabled="true"
                    className={rowClassName}
                  >
                    {rowContent}
                  </button>
                );
              }
              return (
                <Link
                  key={item.href}
                  to={item.href}
                  onClick={onNavigate}
                  aria-current={current ? "page" : undefined}
                  className={rowClassName}
                >
                  {rowContent}
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
      "flex h-16 min-w-0 flex-col items-center justify-center gap-1 text-[10px] font-semibold transition-colors",
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
              <span className="min-w-0 max-w-full truncate whitespace-nowrap">
                {translate(section.titleKey)}
              </span>
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
          <span className="min-w-0 max-w-full truncate whitespace-nowrap">{t("chrome.more")}</span>
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
