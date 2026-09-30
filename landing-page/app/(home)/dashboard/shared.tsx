'use client';

import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { HugeiconsIcon } from '@hugeicons/react';
import {
  Call02Icon,
  Cancel01Icon,
  CheckmarkCircle02Icon,
  CreditCardIcon,
  Invoice01Icon,
  Location01Icon,
  Loading03Icon,
  Package01Icon,
} from '@hugeicons/core-free-icons';
import { cn } from '@/lib/cn';
import { iconMap } from './icons';
import type { DemoIcon } from './types';
import {
  demoCard,
  demoEase,
  demoLabelMini,
  demoMutedText,
  demoRowHover,
  demoSoftTile,
  pillTones,
  type PillTone,
} from './tokens';
import type { DemoOrder } from './data';

/* ------------------------- StatusPill ------------------------- */

export function StatusPill({ label, tone }: { label: string; tone: PillTone }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-[10px] font-semibold ring-1',
        pillTones[tone],
      )}
    >
      {tone === 'success' ? (
        <HugeiconsIcon icon={CheckmarkCircle02Icon} size={13} strokeWidth={1.8} />
      ) : tone === 'progress' ? (
        <HugeiconsIcon icon={Loading03Icon} size={13} strokeWidth={1.8} className="animate-spin" />
      ) : (
        <span className="size-1.5 rounded-full bg-current opacity-80" />
      )}
      {label}
    </span>
  );
}

/* ------------------------- Reveal ------------------------- */

export function Reveal({
  index,
  className,
  children,
}: {
  index: number;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        'w-full max-w-full min-w-0 animate-in fade-in slide-in-from-bottom-4 fill-mode-both duration-500',
        className,
      )}
      style={{ animationDelay: `${index * 75}ms` }}
    >
      {children}
    </div>
  );
}

/* ------------------------- SectionCard ------------------------- */

export function SectionCard({
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
    <section className={cn('w-full max-w-full min-w-0 overflow-hidden rounded-[24px]', demoCard, className)}>
      <header className="flex min-w-0 items-center justify-between gap-4 px-4 pb-1.5 pt-4 sm:px-5">
        <h3 className={demoLabelMini}>{title}</h3>
        {action}
      </header>
      <div className="min-w-0 p-4 pt-3 sm:p-5 sm:pt-3">{children}</div>
    </section>
  );
}

/* ------------------------- MetricCard ------------------------- */

export function MetricCard({
  title,
  value,
  detail,
  icon,
  inverted,
  index,
}: {
  title: string;
  value: ReactNode;
  detail: ReactNode;
  icon: DemoIcon;
  inverted?: boolean;
  index: number;
}) {
  const IconComponent = iconMap[icon];
  return (
    <Reveal index={index} className="h-full w-full max-w-full min-w-0">
      <section
        className={cn(
          'h-full w-full max-w-full min-w-0 overflow-hidden rounded-2xl p-4 sm:p-5',
          inverted
            ? 'bg-[#1c1c1c] text-neutral-50 ring-1 ring-white/10 dark:bg-[#101010] dark:text-neutral-50 dark:ring-white/10'
            : demoCard,
        )}
      >
        <div
          className={cn(
            'flex h-8 w-8 items-center justify-center rounded-lg',
            inverted ? 'bg-white/10 dark:bg-black/10' : 'bg-black/[0.05] dark:bg-white/[0.06]',
          )}
        >
          <HugeiconsIcon icon={IconComponent} size={16} strokeWidth={1.8} />
        </div>
        <div className="mt-6 min-w-0">
          <div className={cn('text-sm', inverted ? 'text-neutral-400 dark:text-neutral-500' : demoMutedText)}>
            {title}
          </div>
          <div className="mt-1 break-words text-2xl font-semibold tabular-nums md:text-3xl">{value}</div>
          <div className="mt-1 text-xs font-medium text-emerald-600 dark:text-emerald-500">
            {detail}
          </div>
        </div>
      </section>
    </Reveal>
  );
}

/* ------------------------- ShortcutStat ------------------------- */

export function ShortcutStat({
  label,
  value,
  detail,
  icon,
  index,
}: {
  label: string;
  value: ReactNode;
  detail: ReactNode;
  icon: DemoIcon;
  index: number;
}) {
  const IconComponent = iconMap[icon];
  return (
    <Reveal index={index} className="min-w-0">
      <div
        className={cn(
          'grid min-w-0 grid-cols-[2.25rem_minmax(0,1fr)] items-center gap-3 rounded-2xl px-3 py-3 transition-colors hover:bg-black/[0.03] dark:hover:bg-white/[0.04]',
          demoCard,
        )}
      >
        <div className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-xl', demoSoftTile)}>
          <HugeiconsIcon icon={IconComponent} size={17} strokeWidth={1.8} />
        </div>
        <div className="min-w-0 overflow-hidden">
          <div className={cn('text-xs font-medium', demoMutedText)}>{label}</div>
          <div className="truncate text-base font-semibold tabular-nums">
            {value} <span className={cn('text-xs font-medium', demoMutedText)}>{detail}</span>
          </div>
        </div>
      </div>
    </Reveal>
  );
}

/* ------------------------- OrdersTable ------------------------- */

/**
 * Premium entrance for rows that arrive after mount (live orders): they mount
 * collapsed, then open on the next frame so the 0fr→1fr height transition and
 * the translate/fade actually play. Pre-existing rows render open immediately.
 */
function useRowEntrance(isNew: boolean) {
  const [entered, setEntered] = useState(!isNew);
  useEffect(() => {
    if (entered) return;
    const frame = requestAnimationFrame(() => setEntered(true));
    return () => cancelAnimationFrame(frame);
  }, [entered]);
  return entered;
}

/** Live rows are stamped "Just now" by the activity script. */
const isLiveOrder = (order: DemoOrder) => order.date === 'Just now';

function MobileOrderCard({
  order,
  showCustomer,
  onSelect,
}: {
  order: DemoOrder;
  showCustomer?: boolean;
  onSelect: (order: DemoOrder) => void;
}) {
  const entered = useRowEntrance(isLiveOrder(order));

  return (
    // Height reveal: the outer grid animates 0fr→1fr so the new card pushes
    // the list down smoothly instead of popping in.
    <div
      className={cn(
        'grid transition-all duration-500',
        demoEase,
        entered ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0',
      )}
    >
      <div className="overflow-hidden">
        <button
          type="button"
          onClick={() => onSelect(order)}
          className={cn(
            'grid w-full max-w-full grid-cols-[minmax(0,1fr)_auto] gap-3 rounded-2xl px-3 py-3 text-start transition-all duration-500',
            demoEase,
            entered ? 'translate-y-0 opacity-100' : 'translate-y-4 opacity-0',
            demoSoftTile,
          )}
        >
          <span className="min-w-0">
            <span className="block truncate text-xs font-semibold tabular-nums">{order.code}</span>
            <span className="mt-0.5 block truncate text-xs">{showCustomer ? order.customer : order.product}</span>
            <span className={cn('mt-0.5 block truncate text-[11px]', demoMutedText)}>{order.date} - {order.payment}</span>
          </span>
          <span className="flex shrink-0 flex-col items-end gap-1">
            <span className="text-xs font-semibold tabular-nums">{order.total}</span>
            <StatusPill label={order.status} tone={order.tone} />
          </span>
        </button>
      </div>
    </div>
  );
}

/**
 * Desktop table row. <tr> can't run the grid height trick, so each cell wraps
 * its content in a 0fr→1fr grid and the cell padding collapses with it — all
 * six cells animate together, which reads as the whole row expanding.
 */
function DesktopOrderRow({
  order,
  showCustomer,
  onSelect,
}: {
  order: DemoOrder;
  showCustomer?: boolean;
  onSelect: (order: DemoOrder) => void;
}) {
  const entered = useRowEntrance(isLiveOrder(order));

  const cell = (content: ReactNode, cellClassName: string, delay: number) => (
    <td
      className={cn(
        'px-3 text-xs transition-all duration-500',
        demoEase,
        entered ? 'py-2.5' : 'py-0',
        cellClassName,
      )}
    >
      <div
        className={cn('grid transition-all duration-500', demoEase, entered ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0')}
      >
        <div className="overflow-hidden">
          <div
            className={cn('transition-all duration-500', demoEase, entered ? 'translate-y-0 opacity-100' : 'translate-y-4 opacity-0')}
            style={{ transitionDelay: entered ? `${delay}ms` : '0ms' }}
          >
            {content}
          </div>
        </div>
      </div>
    </td>
  );

  return (
    <tr onClick={() => onSelect(order)} className="group cursor-pointer">
      {cell(order.code, cn('rounded-l-xl font-medium tabular-nums', demoSoftTile, demoRowHover), 0)}
      {cell(
        <span className="block max-w-[220px] truncate">{showCustomer ? order.customer : order.product}</span>,
        cn(demoSoftTile, demoRowHover),
        75,
      )}
      {cell(<span className="whitespace-nowrap">{order.date}</span>, cn(demoSoftTile, demoRowHover, demoMutedText), 150)}
      {cell(<span className="whitespace-nowrap font-medium tabular-nums">{order.total}</span>, cn(demoSoftTile, demoRowHover), 225)}
      {cell(order.payment, cn(demoSoftTile, demoRowHover, demoMutedText), 300)}
      {cell(
        <StatusPill label={order.status} tone={order.tone} />,
        cn('rounded-r-xl text-right', demoSoftTile, demoRowHover),
        375,
      )}
    </tr>
  );
}

export function OrdersTable({
  orders,
  showCustomer,
  onSelect,
}: {
  orders: DemoOrder[];
  showCustomer?: boolean;
  onSelect: (order: DemoOrder) => void;
}) {
  return (
    <>
      <div className="w-full max-w-full space-y-2 overflow-hidden md:hidden">
        {orders.map((order) => (
          <MobileOrderCard key={order.code} order={order} showCustomer={showCustomer} onSelect={onSelect} />
        ))}
      </div>
      <div className="no-scrollbar hidden overflow-x-auto md:block">
        <table className="w-full min-w-[640px] border-separate border-spacing-y-2 text-sm">
          <thead>
            <tr className="text-left">
              {['Transfer ID', showCustomer ? 'Recipient' : 'Memo', 'Date', 'Amount', 'Method', 'Status'].map(
                (heading, index, all) => (
                  <th
                    key={heading}
                    className={cn('px-3 pb-1 pt-2', demoLabelMini, index === all.length - 1 && 'text-right')}
                  >
                    {heading}
                  </th>
                ),
              )}
            </tr>
          </thead>
          <tbody>
            {orders.map((order) => (
              <DesktopOrderRow key={order.code} order={order} showCustomer={showCustomer} onSelect={onSelect} />
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

/* ------------------------- ExpandCollapse ------------------------- */

export function ExpandCollapse({
  isOpen,
  children,
  className,
}: {
  isOpen: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      inert={!isOpen}
      className={cn(
        'grid transition-all duration-500',
        demoEase,
        isOpen ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0',
        className,
      )}
    >
      <div className="overflow-hidden">{children}</div>
    </div>
  );
}

/* ------------------------- OrderDetailSheet ------------------------- */

export function OrderDetailSheet({ order, onClose }: { order: DemoOrder | null; onClose: () => void }) {
  const isOpen = order !== null;
  const staggerClass = cn(
    'transition-all duration-500',
    demoEase,
    isOpen ? 'translate-y-0 opacity-100' : 'translate-y-4 opacity-0',
  );
  const staggerDelay = (index: number) => ({
    transitionDelay: isOpen ? `${index * 75}ms` : '0ms',
  });

  return (
    <>
      <div
        aria-hidden
        onClick={onClose}
        className={cn(
          'absolute inset-0 z-20 bg-transparent transition-opacity duration-500',
          demoEase,
          isOpen ? 'opacity-100' : 'pointer-events-none opacity-0',
        )}
      />
      <aside
        inert={!isOpen}
        className={cn(
          'absolute inset-y-0 right-0 z-30 flex w-full max-w-[calc(100%-0.75rem)] flex-col bg-white text-neutral-900 shadow-none transition-transform duration-500 sm:max-w-[400px] dark:bg-[#101010] dark:text-neutral-100',
          demoEase,
          isOpen ? 'translate-x-0' : 'translate-x-full',
        )}
      >
        {order && (
          <>
            <header className="flex shrink-0 items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-semibold tabular-nums">{order.code}</h3>
                  <StatusPill label={order.status} tone={order.tone} />
                </div>
                <p className={cn('mt-0.5 text-[11px]', demoMutedText)}>{order.date} · {order.payment}</p>
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close transfer details"
                className="flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-xl bg-[#f2f2f2] transition-colors hover:bg-[#e8e8e8]"
              >
                <HugeiconsIcon icon={Cancel01Icon} size={15} strokeWidth={1.8} />
              </button>
            </header>

            <div className="no-scrollbar min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
              <section className={cn('rounded-2xl p-4', demoCard, staggerClass)} style={staggerDelay(0)}>
                <h4 className={cn(demoLabelMini, 'mb-3')}>Recipient</h4>
                <div className="flex items-center gap-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-neutral-900 text-[11px] font-semibold text-white dark:bg-neutral-100 dark:text-neutral-900">
                    {order.customer.split(' ').map((part) => part[0]).join('')}
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-xs font-semibold">{order.customer}</p>
                    <p className={cn('flex items-center gap-1 text-[11px] tabular-nums', demoMutedText)}>
                      <HugeiconsIcon icon={Call02Icon} size={12} strokeWidth={1.8} />
                      {order.phone}
                    </p>
                  </div>
                </div>
                <div className={cn('mt-3 flex items-start gap-2 rounded-xl px-3 py-2.5 text-[11px]', demoSoftTile)}>
                  <HugeiconsIcon icon={Location01Icon} size={13} strokeWidth={1.8} className="mt-0.5 shrink-0" />
                  <span>
                    <span className="font-medium">{order.governorate} · {order.city}</span>
                    <span className={cn('block', demoMutedText)}>{order.address}</span>
                  </span>
                </div>
              </section>

              <section className={cn('rounded-2xl p-4', demoCard, staggerClass)} style={staggerDelay(1)}>
                <h4 className={cn(demoLabelMini, 'mb-3')}>Details</h4>
                <div className="space-y-2">
                  {order.items.map((item) => (
                    <div key={item.name} className={cn('flex items-center gap-3 rounded-xl px-3 py-2.5', demoSoftTile)}>
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-black/[0.06] dark:bg-white/[0.07]">
                        <HugeiconsIcon icon={Package01Icon} size={15} strokeWidth={1.8} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-xs font-medium">{item.name}</p>
                        <p className={cn('text-[11px] tabular-nums', demoMutedText)}>Qty {item.quantity}</p>
                      </div>
                      <span className="text-xs font-semibold tabular-nums">{item.price}</span>
                    </div>
                  ))}
                </div>
              </section>

              <section className={cn('rounded-2xl p-4', demoCard, staggerClass)} style={staggerDelay(2)}>
                <h4 className={cn(demoLabelMini, 'mb-3')}>Summary</h4>
                <dl className="space-y-1.5 text-xs">
                  <div className="flex items-center justify-between">
                    <dt className={demoMutedText}>Amount</dt>
                    <dd className="font-medium tabular-nums">{order.subtotal}</dd>
                  </div>
                  <div className="flex items-center justify-between">
                    <dt className={demoMutedText}>Network fee</dt>
                    <dd className="font-medium tabular-nums">{order.shippingFee}</dd>
                  </div>
                  <div className="flex items-center justify-between pt-2">
                    <dt className="flex items-center gap-1.5 font-semibold">
                      <HugeiconsIcon icon={CreditCardIcon} size={13} strokeWidth={1.8} />
                      Total · {order.payment}
                    </dt>
                    <dd className="text-sm font-semibold tabular-nums">{order.total}</dd>
                  </div>
                </dl>
              </section>

              <section className={cn('rounded-2xl p-4', demoCard, staggerClass)} style={staggerDelay(3)}>
                <h4 className={cn(demoLabelMini, 'mb-3')}>Timeline</h4>
                <ol className="space-y-0">
                  {order.timeline.map((event, index) => (
                    <li key={event.label} className="relative flex gap-3 pb-4 last:pb-0">
                      {index < order.timeline.length - 1 && (
                        <span aria-hidden className="absolute left-[7px] top-4 h-full w-px bg-black/10 dark:bg-white/10" />
                      )}
                      <span
                        className={cn(
                          'relative mt-0.5 flex h-[15px] w-[15px] shrink-0 items-center justify-center rounded-full ring-2',
                          event.done
                            ? 'bg-emerald-500 text-white ring-emerald-500/25'
                            : 'bg-black/10 ring-black/5 dark:bg-white/15 dark:ring-white/10',
                        )}
                      >
                        {event.done && <HugeiconsIcon icon={CheckmarkCircle02Icon} size={11} strokeWidth={2} />}
                      </span>
                      <div className="min-w-0">
                        <p className={cn('text-xs', event.done ? 'font-medium' : demoMutedText)}>{event.label}</p>
                        <p className={cn('text-[11px] tabular-nums', demoMutedText)}>{event.time}</p>
                      </div>
                    </li>
                  ))}
                </ol>
              </section>
            </div>

            <footer className={cn('shrink-0 p-4', staggerClass)} style={staggerDelay(4)}>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="flex-1 cursor-pointer rounded-xl bg-neutral-900 px-3 py-2 text-xs font-semibold text-white transition-opacity hover:opacity-85 dark:bg-neutral-100 dark:text-neutral-900"
                >
                  <span className="inline-flex items-center gap-1.5">
                    <HugeiconsIcon icon={Invoice01Icon} size={14} strokeWidth={1.8} />
                    Print receipt
                  </span>
                </button>
                <button
                  type="button"
                  onClick={onClose}
                  className="flex-1 cursor-pointer rounded-xl bg-[#f2f2f2] px-3 py-2 text-xs font-semibold transition-colors hover:bg-[#e8e8e8]"
                >
                  Edit transfer
                </button>
              </div>
            </footer>
          </>
        )}
      </aside>
    </>
  );
}
