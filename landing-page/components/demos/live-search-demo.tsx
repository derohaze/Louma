'use client';

import { useState } from 'react';
import { cn } from '@/lib/cn';

const searchEntries = [
  { title: 'Transfers', description: 'Review new transfers and settlement status.' },
  { title: 'Balance', description: 'View your balance and receiving address.' },
  { title: 'Contacts', description: 'Keep recipients and transfer context together.' },
  { title: 'Settlement', description: 'Follow settlement events and confirmation status.' },
  { title: 'Activity', description: 'See activity tied to daily decisions.' },
];

const demoMutedText = 'text-neutral-500 dark:text-neutral-400';
const demoEase = 'ease-[cubic-bezier(0.4,0,0.2,1)]';

export function LiveSearchDemo() {
  const [query, setQuery] = useState('');
  const normalized = query.trim().toLowerCase();
  const matchCount = searchEntries.filter(
    (entry) =>
      entry.title.toLowerCase().includes(normalized) ||
      entry.description.toLowerCase().includes(normalized),
  ).length;

  return (
    <div className="flex flex-col mt-auto bg-fd-popover rounded-xl border mask-[linear-gradient(to_bottom,white_40%,transparent_95%)] max-md:-mx-4">
      <div className="flex items-center gap-2 border-b px-4 py-3">
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search your wallet…"
          className="w-full bg-transparent text-sm text-fd-popover-foreground outline-none placeholder:text-fd-muted-foreground"
        />
        <span className={cn('shrink-0 text-[10px] font-semibold tabular-nums', demoMutedText)}>
          {matchCount}/{searchEntries.length}
        </span>
      </div>
      <div className="p-2">
        {searchEntries.map((entry, index) => {
          const matches =
            normalized === '' ||
            entry.title.toLowerCase().includes(normalized) ||
            entry.description.toLowerCase().includes(normalized);
          const highlighted = normalized !== '' && matches;
          return (
            <div
              key={entry.title}
              aria-hidden={!matches}
              className={cn(
                'grid transition-all duration-500',
                demoEase,
                matches ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0',
              )}
            >
              <div className="overflow-hidden">
                <div
                  className={cn(
                    'rounded-md p-2 text-sm text-fd-popover-foreground transition-colors',
                    (highlighted || (normalized === '' && index === 0)) && 'bg-fd-accent',
                  )}
                >
                  <p className="font-medium">{entry.title}</p>
                  <p className="mt-1 text-xs text-fd-muted-foreground">{entry.description}</p>
                </div>
              </div>
            </div>
          );
        })}
        <p
          className={cn(
            'px-2 text-xs text-fd-muted-foreground transition-all duration-300',
            matchCount === 0 ? 'py-3 opacity-100' : 'h-0 overflow-hidden py-0 opacity-0',
          )}
        >
          No results — try &ldquo;transfers&rdquo; or &ldquo;settlement&rdquo;.
        </p>
      </div>
    </div>
  );
}
