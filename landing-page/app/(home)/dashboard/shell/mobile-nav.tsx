'use client';

import { HugeiconsIcon } from '@hugeicons/react';
import { MoreHorizontalCircle01Icon } from '@hugeicons/core-free-icons';
import { cn } from '@/lib/cn';
import { iconMap } from '../icons';
import { demoLabelMini, demoMutedText } from '../tokens';
import { demoNavItems, type DemoPageKey } from '../data';
import type { DemoNavItem } from '../types';

const mobilePrimaryPages: DemoPageKey[] = ['overview', 'orders', 'products', 'customers'];
const mobileOverflowPages = demoNavItems.filter((item) => !mobilePrimaryPages.includes(item.key));

export function MobileDemoBottomNav({
  page,
  moreOpen,
  onNavigate,
  onToggleMore,
}: {
  page: DemoPageKey;
  moreOpen: boolean;
  onNavigate: (page: DemoPageKey) => void;
  onToggleMore: () => void;
}) {
  const primaryItems = mobilePrimaryPages
    .map((key) => demoNavItems.find((item) => item.key === key))
    .filter((item): item is DemoNavItem => Boolean(item));
  const activePrimaryIndex = primaryItems.findIndex((item) => item.key === page);
  const activeOverflow = mobileOverflowPages.some((item) => item.key === page);
  const activeIndex = moreOpen || activeOverflow ? primaryItems.length : activePrimaryIndex;
  const itemCount = primaryItems.length + 1;

  return (
    <div className="absolute inset-x-0 bottom-0 z-30 lg:hidden">
      {moreOpen && (
        <>
          <button
            type="button"
            aria-label="Close navigation menu"
            className="absolute inset-x-0 bottom-0 top-[-420px] cursor-default bg-transparent"
            onClick={onToggleMore}
          />
          <div className="absolute inset-x-2 bottom-[72px] max-w-full overflow-hidden rounded-2xl bg-white p-3 shadow-none dark:bg-[#161616]">
            <div className="mb-2 flex items-center justify-between px-1">
              <span className={demoLabelMini}>More</span>
              <span className={cn('text-[11px]', demoMutedText)}>Demo pages</span>
            </div>
            <div className="grid grid-cols-2 gap-2 min-[360px]:grid-cols-3">
              {mobileOverflowPages.map((item) => {
                const active = item.key === page;
                const IconComponent = iconMap[item.icon];
                return (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => onNavigate(item.key)}
                    className={cn(
                      'flex min-h-16 flex-col items-center justify-center gap-1 rounded-2xl px-2 text-[11px] font-semibold transition-colors',
                      active
                        ? 'bg-neutral-900 text-white dark:bg-[#303030] dark:text-neutral-100'
                        : 'bg-[#f2f2f2] text-neutral-600 hover:bg-[#e8e8e8] dark:bg-[#242424] dark:text-neutral-300 dark:hover:bg-[#303030]',
                    )}
                  >
                    <HugeiconsIcon icon={IconComponent} size={18} strokeWidth={1.8} />
                    <span className="max-w-full truncate">{item.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </>
      )}

      <nav className="mx-2 mb-2 rounded-2xl bg-white px-2 pb-2 pt-2 shadow-none dark:bg-[#161616]">
        <div className="relative grid" style={{ gridTemplateColumns: `repeat(${itemCount}, minmax(0, 1fr))` }}>
          {activeIndex >= 0 && (
            <span
              aria-hidden="true"
              className="absolute inset-y-0 left-0 rounded-2xl bg-[#f2f2f2] transition-transform duration-500 dark:bg-[#242424]"
              style={{
                width: `${100 / itemCount}%`,
                transform: `translateX(${activeIndex * 100}%)`,
                transitionTimingFunction: 'cubic-bezier(0.4,0,0.2,1)',
              }}
            />
          )}
          {primaryItems.map((item) => {
            const active = item.key === page && !moreOpen;
            const IconComponent = iconMap[item.icon];
            return (
              <button
                key={item.key}
                type="button"
                onClick={() => onNavigate(item.key)}
                className={cn(
                  'relative z-10 flex h-14 min-w-0 flex-col items-center justify-center gap-1 rounded-2xl px-1 text-[10px] font-semibold transition-colors',
                  active ? 'text-neutral-950 dark:text-neutral-100' : 'text-neutral-500 dark:text-neutral-400',
                )}
              >
                <HugeiconsIcon icon={IconComponent} size={18} strokeWidth={1.8} />
                <span className="max-w-full truncate">{item.label}</span>
              </button>
            );
          })}
          <button
            type="button"
            onClick={onToggleMore}
            aria-expanded={moreOpen}
            className={cn(
              'relative z-10 flex h-14 min-w-0 flex-col items-center justify-center gap-1 rounded-2xl px-1 text-[10px] font-semibold transition-colors',
              moreOpen || activeOverflow ? 'text-neutral-950 dark:text-neutral-100' : 'text-neutral-500 dark:text-neutral-400',
            )}
          >
            <HugeiconsIcon icon={MoreHorizontalCircle01Icon} size={18} strokeWidth={1.8} />
            <span>More</span>
          </button>
        </div>
      </nav>
    </div>
  );
}
