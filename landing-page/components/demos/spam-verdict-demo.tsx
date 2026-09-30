'use client';

import { useState } from 'react';
import { cn } from '@/lib/cn';

export function SpamVerdictWindowDemo({ className }: { className?: string }) {
  const [blocked, setBlocked] = useState(false);

  return (
    <div
      className={cn(
        'flex flex-col rounded-xl border bg-neutral-100 text-neutral-800 shadow-lg dark:bg-neutral-900 dark:text-neutral-200',
        className,
      )}
    >
      <div className="border-b px-4 py-2 text-sm font-medium text-neutral-500 dark:text-neutral-400">
        Transfer review
      </div>
      <div className="p-3">
        <div className="flex items-baseline justify-between gap-2">
          <p className="text-xs font-semibold tabular-nums">#EF-1859 · Unknown sender</p>
          <span className="rounded-md bg-black/[0.06] px-2 py-0.5 text-[10px] font-semibold tabular-nums dark:bg-white/[0.1]">
            91/100
          </span>
        </div>
        <p className="mt-1.5 text-[11px] text-neutral-500 dark:text-neutral-400">
          {blocked
            ? 'Transfer blocked — this address is flagged for future transfers.'
            : 'Address flagged in 3 accounts · identity failed validation.'}
        </p>
        <button
          type="button"
          onClick={() => setBlocked((value) => !value)}
          className="mt-2.5 rounded-lg border px-3 py-1.5 text-[11px] font-semibold transition-colors hover:bg-black/5 dark:hover:bg-white/10"
        >
          {blocked ? 'Undo decision' : 'Block transfer'}
        </button>
      </div>
    </div>
  );
}
