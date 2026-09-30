'use client';

import { useState } from 'react';
import {
  BanIcon,
  CircleCheckIcon,
  FlagIcon,
  RotateCcwIcon,
  ShieldCheckIcon,
} from 'lucide-react';
import { cn } from '@/lib/cn';

type ReviewStatus = 'Confirmed' | 'Needs review' | 'Blocked';

interface ReviewOrder {
  code: string;
  createdAt: string;
  customer: string;
  phone: string;
  governorate: string;
  city: string;
  total: string;
  status: ReviewStatus;
  score: number;
  signals: string[];
}

const reviewQueueOrders: ReviewOrder[] = [
  {
    code: '#EF-1839',
    createdAt: 'Jul 4, 10:24',
    customer: 'Salma Adel',
    phone: '+20 100 ••• 4821',
    governorate: 'Cairo',
    city: 'Nasr City',
    total: '840',
    status: 'Confirmed',
    score: 12,
    signals: ['Repeat recipient', 'Phone verified', 'Address matches history'],
  },
  {
    code: '#EF-1842',
    createdAt: 'Jul 4, 10:31',
    customer: 'Ahmed Hassan',
    phone: '+20 111 ••• 0932',
    governorate: 'Giza',
    city: 'Dokki',
    total: '1,250',
    status: 'Needs review',
    score: 72,
    signals: ['Suspicious phone pattern', 'Address details unclear', 'Identity not verified'],
  },
  {
    code: '#EF-1846',
    createdAt: 'Jul 4, 10:38',
    customer: 'Unknown sender',
    phone: '+20 109 ••• 7714',
    governorate: 'Alexandria',
    city: 'Smouha',
    total: '620',
    status: 'Blocked',
    score: 91,
    signals: ['Phone flagged in 3 accounts', 'Address failed validation', 'Reversed before'],
  },
];

const reviewStatusStyles: Record<
  ReviewStatus,
  {
    pill: string;
    accent: string;
    selectedRow: string;
    panel: string;
    panelIcon: string;
    Icon: typeof FlagIcon;
  }
> = {
  Confirmed: {
    pill: 'border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
    accent: '',
    selectedRow: 'bg-emerald-500/5',
    panel: 'border-emerald-500/25 bg-emerald-500/10 text-emerald-900 dark:text-emerald-100',
    panelIcon: 'text-emerald-600 dark:text-emerald-400',
    Icon: CircleCheckIcon,
  },
  'Needs review': {
    pill: 'border-amber-500/25 bg-amber-500/15 text-amber-800 dark:text-amber-300',
    accent: 'bg-amber-500',
    selectedRow: 'bg-amber-500/5',
    panel: 'border-amber-500/25 bg-amber-500/10 text-amber-900 dark:text-amber-100',
    panelIcon: 'text-amber-600 dark:text-amber-400',
    Icon: FlagIcon,
  },
  Blocked: {
    pill: 'border-red-500/20 bg-red-500/10 text-red-700 dark:text-red-400',
    accent: 'bg-red-500',
    selectedRow: 'bg-red-500/5',
    panel: 'border-red-500/25 bg-red-500/10 text-red-900 dark:text-red-100',
    panelIcon: 'text-red-600 dark:text-red-400',
    Icon: BanIcon,
  },
};

const reviewPanelNotes: Record<ReviewStatus, string> = {
  Confirmed: 'Auto-approved by the bot — signals look clean.',
  'Needs review': 'AI review pending — transfer held until a decision is made.',
  Blocked: 'Auto-blocked by the bot — release it manually if the transfer is legitimate.',
};

const reviewDecisionNotes: Record<'Confirmed' | 'Blocked', string> = {
  Confirmed: 'Marked as safe — transfer released to your history.',
  Blocked: 'Transfer blocked — this address is flagged for future transfers.',
};

const reviewRowGrid =
  'grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-3 sm:grid-cols-[92px_minmax(0,1fr)_128px_100px_124px] sm:gap-5 sm:px-5';

const reviewEase = 'ease-[cubic-bezier(0.4,0,0.2,1)]';

const reviewPanelButton =
  'inline-flex items-center gap-1.5 rounded-lg border border-current/20 bg-white/40 px-3.5 py-2 text-xs font-semibold transition-colors hover:bg-white/70 dark:bg-white/10 dark:hover:bg-white/20';

function suspicionLabel(score: number) {
  if (score >= 80) return 'High suspicion';
  if (score >= 40) return 'Medium suspicion';
  return 'Low suspicion';
}

function ReviewOrderPanel({
  order,
  status,
  decision,
  isOpen,
  onDecide,
  onUndo,
}: {
  order: ReviewOrder;
  status: ReviewStatus;
  decision: 'Confirmed' | 'Blocked' | undefined;
  isOpen: boolean;
  onDecide: (decision: 'Confirmed' | 'Blocked') => void;
  onUndo: () => void;
}) {
  const styles = reviewStatusStyles[status];
  const PanelIcon = styles.Icon;

  const staggerClass = cn(
    'transition-all duration-500',
    reviewEase,
    isOpen ? 'translate-y-0' : 'translate-y-4 opacity-0',
  );
  const staggerDelay = (index: number) => ({
    transitionDelay: isOpen ? `${index * 75}ms` : '0ms',
  });

  return (
    <div
      aria-hidden={!isOpen}
      inert={!isOpen}
      className={cn(
        'grid transition-all duration-500',
        reviewEase,
        isOpen ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0',
      )}
    >
      <div className="overflow-hidden">
        <div className={cn('rounded-2xl border px-4 py-4', styles.panel)}>
          <div className={cn('flex items-center gap-2', staggerClass)} style={staggerDelay(0)}>
            <PanelIcon className={cn('size-4 shrink-0', styles.panelIcon)} />
            <p className="text-sm font-semibold">
              {suspicionLabel(order.score)} &middot; {order.code}
            </p>
            <span className="ms-auto rounded-md border border-current/15 bg-white/50 px-2 py-0.5 text-xs font-semibold tabular-nums dark:bg-white/10">
              {order.score}/100
            </span>
          </div>
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            {order.signals.map((signal, index) => (
              <span
                key={signal}
                className={cn(
                  'max-w-full truncate rounded-md border border-current/15 bg-white/50 px-2.5 py-1 text-xs font-medium dark:bg-white/10',
                  staggerClass,
                )}
                style={staggerDelay(1 + index)}
              >
                {signal}
              </span>
            ))}
          </div>
          <p
            className={cn('mt-2.5 text-xs font-medium opacity-80', staggerClass)}
            style={staggerDelay(1 + order.signals.length)}
          >
            {decision ? reviewDecisionNotes[decision] : reviewPanelNotes[status]}
          </p>
          <div className={staggerClass} style={staggerDelay(2 + order.signals.length)}>
            <div className="mt-3 flex flex-wrap gap-2">
              {decision ? (
                <button type="button" onClick={onUndo} className={reviewPanelButton}>
                  <RotateCcwIcon className="size-3.5" />
                  Undo decision
                </button>
              ) : (
                <>
                  {status !== 'Confirmed' && (
                    <button
                      type="button"
                      onClick={() => onDecide('Confirmed')}
                      className={reviewPanelButton}
                    >
                      <CircleCheckIcon className="size-3.5" />
                      Mark as safe
                    </button>
                  )}
                  {status === 'Needs review' && (
                    <button
                      type="button"
                      onClick={() => onDecide('Blocked')}
                      className={reviewPanelButton}
                    >
                      <BanIcon className="size-3.5" />
                      Block transfer
                    </button>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function AntiSpamReviewPreview() {
  const [selectedCode, setSelectedCode] = useState('#EF-1842');
  const [decisions, setDecisions] = useState<Record<string, 'Confirmed' | 'Blocked'>>({});

  const statusOf = (order: ReviewOrder): ReviewStatus => decisions[order.code] ?? order.status;

  const decide = (code: string, decision: 'Confirmed' | 'Blocked') => {
    setDecisions((prev) => ({ ...prev, [code]: decision }));
  };
  const undoDecision = (code: string) => {
    setDecisions((prev) => {
      const { [code]: _removed, ...rest } = prev;
      return rest;
    });
  };

  return (
    <div className="overflow-hidden rounded-xl border bg-white text-neutral-950 shadow-md dark:bg-neutral-900 dark:text-neutral-50">
      <div className="flex flex-col gap-3 border-b bg-neutral-50 p-3 sm:p-5 md:flex-row md:items-center dark:bg-neutral-800/50">
        <div className="flex items-center gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-[#fff383] text-black sm:size-11">
            <ShieldCheckIcon className="size-5" />
          </div>
          <div className="min-w-0">
            <h2 className="text-base font-semibold sm:text-lg">Suspicious transfer review</h2>
            <p className="text-sm text-neutral-500 dark:text-neutral-400">
              Bot checks every new transfer before you act.
            </p>
          </div>
        </div>
        <div className="flex w-fit items-center gap-2 rounded-full border bg-white px-3 py-1.5 text-xs font-medium text-neutral-600 md:ms-auto dark:bg-neutral-900 dark:text-neutral-300">
          <span className="size-2 rounded-full bg-emerald-500" />
          Live review queue
        </div>
      </div>

      <div className="space-y-4 p-3 sm:p-5">
        <div className="overflow-hidden rounded-xl border">
          <div
            className={cn(
              reviewRowGrid,
              'border-b bg-neutral-50 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-neutral-500 dark:bg-neutral-800/50 dark:text-neutral-400',
            )}
          >
            <span>Transfer</span>
            <span className="max-sm:hidden">Recipient</span>
            <span className="max-sm:hidden">Governorate</span>
            <span className="text-end max-sm:hidden">Amount</span>
            <span className="text-end">Status</span>
          </div>
          {reviewQueueOrders.map((order) => {
            const status = statusOf(order);
            const styles = reviewStatusStyles[status];
            const selected = order.code === selectedCode;

            return (
              <button
                key={order.code}
                type="button"
                aria-pressed={selected}
                onClick={() => setSelectedCode(order.code)}
                className={cn(
                  reviewRowGrid,
                  'relative w-full cursor-pointer py-2.5 text-start transition-colors not-last:border-b hover:bg-neutral-500/5',
                  selected && styles.selectedRow,
                )}
              >
                {styles.accent && (
                  <span
                    aria-hidden
                    className={cn('absolute inset-y-2 left-1 w-[3px] rounded-full', styles.accent)}
                  />
                )}
                <div className="min-w-0 leading-tight">
                  <p className="truncate text-xs font-semibold tabular-nums">{order.code}</p>
                  <p className="mt-0.5 truncate text-[11px] font-medium max-sm:block sm:hidden">
                    {order.customer}
                  </p>
                  <p className="mt-0.5 truncate text-[11px] tabular-nums text-neutral-500 dark:text-neutral-400">
                    {order.createdAt}
                  </p>
                </div>
                <div className="min-w-0 leading-tight max-sm:hidden">
                  <p className="truncate text-xs font-medium">{order.customer}</p>
                  <p className="mt-0.5 truncate text-[11px] tabular-nums text-neutral-500 dark:text-neutral-400">
                    {order.phone}
                  </p>
                </div>
                <div className="min-w-0 leading-tight max-sm:hidden">
                  <p className="truncate text-xs font-medium">{order.governorate}</p>
                  <p className="mt-0.5 truncate text-[11px] text-neutral-500 dark:text-neutral-400">
                    {order.city}
                  </p>
                </div>
                <span className="text-end text-xs font-semibold tabular-nums max-sm:hidden">
                  {order.total}
                </span>
                <span
                  className={cn(
                    'inline-flex items-center gap-1.5 justify-self-end whitespace-nowrap rounded-full border px-2.5 py-1 text-[11px] font-semibold',
                    styles.pill,
                  )}
                >
                  <span className="size-1.5 rounded-full bg-current opacity-80" />
                  {status}
                </span>
              </button>
            );
          })}
        </div>

        <div>
          {reviewQueueOrders.map((order) => (
            <ReviewOrderPanel
              key={order.code}
              order={order}
              status={statusOf(order)}
              decision={decisions[order.code]}
              isOpen={order.code === selectedCode}
              onDecide={(decision) => decide(order.code, decision)}
              onUndo={() => undoDecision(order.code)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
