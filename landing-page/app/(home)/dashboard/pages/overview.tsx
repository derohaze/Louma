'use client';

import { HugeiconsIcon } from '@hugeicons/react';
import {
  Activity01Icon,
  Cancel01Icon,
  ChartBarBigIcon,
  CheckmarkCircle02Icon,
  ChevronRightIcon,
  DeliveryTruck01Icon,
  File01Icon,
  Mail01Icon,
  Megaphone01Icon,
  Package01Icon,
  Plug01Icon,
  ShoppingBag01Icon,
  StoreLocation01Icon,
  UserGroupIcon,
  UserSettings01Icon,
} from '@hugeicons/core-free-icons';
import { cn } from '@/lib/cn';
import {
  demoCard,
  demoEase,
  demoLabelMini,
  demoMutedText,
  demoSoftTile,
  pillTones,
} from '../tokens';
import NumberFlow from '@number-flow/react';
import {
  demoRevenueTrend,
  demoTopProducts,
  demoPulseMetrics,
  demoOperationalRows,
  demoPlatformPerformance,
  demoOrders,
  demoTeam,
  demoIntegrations,
  type DemoOrder,
} from '../data';
import { Reveal, SectionCard, MetricCard, ShortcutStat, OrdersTable, StatusPill } from '../shared';
import { useLiveActivity } from '../live-activity';

/** Shared NumberFlow recipe: grouped digits, snappy spin. */
function LiveNumber({ value, decimals = 0 }: { value: number; decimals?: number }) {
  return (
    <NumberFlow
      value={value}
      format={{ minimumFractionDigits: decimals, maximumFractionDigits: decimals }}
    />
  );
}

export function OverviewDemoPage({ onSelectOrder }: { onSelectOrder: (order: DemoOrder) => void }) {
  const maxRevenue = Math.max(...demoRevenueTrend.map((month) => month.revenue));
  const { metrics, liveOrders } = useLiveActivity();

  // Derived figures stay consistent with the raw counters as events land.
  const avgOrderValue = Math.round(metrics.grossValue / metrics.totalOrders);
  const deliveryRate = (metrics.deliveredOrders / metrics.totalOrders) * 100;
  const newCustomerShare = (metrics.newCustomers / metrics.customers) * 100;
  const repeatRate = (metrics.repeatCustomers / metrics.customers) * 100;

  // First three pulse tiles go live; the static tail keeps its scripted copy.
  const livePulseMetrics = [
    {
      label: 'New recipients',
      value: <LiveNumber value={metrics.newCustomers} />,
      detail: (
        <>
          <LiveNumber value={newCustomerShare} decimals={1} />% of recipients
        </>
      ),
      accent: '+12%',
    },
    {
      label: 'Repeat recipients',
      value: <LiveNumber value={metrics.repeatCustomers} />,
      detail: (
        <>
          <LiveNumber value={repeatRate} decimals={1} />% repeat rate
        </>
      ),
      accent: '+4%',
    },
    {
      label: 'Transfers / recipient',
      value: <LiveNumber value={metrics.totalOrders / metrics.activeCustomers} decimals={1} />,
      detail: (
        <>
          <LiveNumber value={metrics.totalOrders} /> tracked transfers
        </>
      ),
      accent: '87%',
    },
    ...demoPulseMetrics.slice(3),
  ];

  return (
    <div className="w-full max-w-full min-w-0 space-y-5 overflow-hidden">
      <Reveal index={0}>
        <h2 className="text-xl font-semibold tracking-normal md:text-2xl">Welcome back</h2>
      </Reveal>
      <div className="grid w-full max-w-full min-w-0 grid-cols-1 gap-4 md:grid-cols-3 md:gap-5">
        <MetricCard
          title="Avg. transfer value"
          value={<LiveNumber value={avgOrderValue} />}
          detail={<>Last 30 days - <LiveNumber value={metrics.totalOrders} /> transfers</>}
          icon="File01Icon"
          index={1}
        />
        <MetricCard
          title="Total transfers"
          value={<LiveNumber value={metrics.totalOrders} />}
          detail={<><LiveNumber value={metrics.deliveredOrders} /> settled - <LiveNumber value={deliveryRate} decimals={1} />%</>}
          icon="ShoppingBag01Icon"
          index={2}
        />
        <MetricCard
          title="Transferred volume"
          value={<LiveNumber value={metrics.grossValue} />}
          detail={<>Last 30 days - <LiveNumber value={metrics.activeCustomers} /> recipients</>}
          icon="ChartBarBigIcon"
          index={3}
        />
      </div>
      <div className="grid w-full max-w-full min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <ShortcutStat label="Addresses" value="248" detail="231 active" icon="Package01Icon" index={4} />
        <ShortcutStat
          label="Recipients"
          value={<LiveNumber value={metrics.customers} />}
          detail={<><LiveNumber value={metrics.repeatCustomers} /> repeat</>}
          icon="UserGroupIcon"
          index={5}
        />
        <ShortcutStat label="Contacts" value="12" detail="8 trusted" icon="UserSettings01Icon" index={6} />
        <ShortcutStat label="Services" value="4" detail="connected" icon="Plug01Icon" index={7} />
      </div>
      <Reveal index={8}>
        <div className="grid w-full max-w-full min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {livePulseMetrics.map((metric) => (
            <div key={metric.label} className={cn('min-w-0 overflow-hidden rounded-2xl px-4 py-3', demoCard)}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className={cn('truncate text-[11px] font-semibold uppercase tracking-[0.08em]', demoMutedText)}>{metric.label}</p>
                  <p className="mt-1 text-xl font-semibold tabular-nums">{metric.value}</p>
                  <p className={cn('mt-0.5 truncate text-[11px]', demoMutedText)}>{metric.detail}</p>
                </div>
                <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-600 dark:text-emerald-400">
                  {metric.accent}
                </span>
              </div>
            </div>
          ))}
        </div>
      </Reveal>
      <div className="grid w-full max-w-full min-w-0 grid-cols-1 items-stretch gap-5 xl:grid-cols-[minmax(0,1.35fr)_minmax(300px,0.85fr)]">
        <Reveal index={9}>
          <SectionCard title="Transfer volume" action={<span className={cn('text-[11px] font-semibold tabular-nums', demoMutedText)}>Transfers + volume</span>}>
            <div className="flex h-[210px] items-end gap-2 sm:gap-3">
              {demoRevenueTrend.map((month, index) => {
                const best = month.revenue === maxRevenue;
                return (
                  <div key={month.label} className="group/bar flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1.5">
                    <span className={cn('text-[10px] font-semibold tabular-nums opacity-0 transition-opacity group-hover/bar:opacity-100', best && 'opacity-100')}>
                      {month.revenue}k
                    </span>
                    <div className={cn('relative flex w-full max-w-10 items-end justify-center overflow-hidden rounded-t-xl', demoSoftTile)} style={{ height: `${(month.orders / 1284) * 100}%` }}>
                      <div
                        className={cn('w-full rounded-t-xl bg-neutral-900 duration-700 animate-in slide-in-from-bottom-full dark:bg-neutral-100', demoEase)}
                        style={{ height: `${(month.revenue / maxRevenue) * 100}%`, animationDelay: `${index * 60}ms` }}
                      />
                    </div>
                    <span className={cn('text-[10px] font-semibold', demoMutedText)}>{month.label}</span>
                  </div>
                );
              })}
            </div>
          </SectionCard>
        </Reveal>
        <Reveal index={10}>
          <SectionCard title="Top recipients" action={<span className="text-xs font-medium text-indigo-600">View recipients</span>}>
            <div className="space-y-3">
              {demoTopProducts.map((product, index) => (
                <div key={product.name} className="flex items-center gap-3 rounded-xl px-1 py-1 transition-colors hover:bg-black/[0.04] dark:hover:bg-white/[0.06]">
                  <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-black/[0.06] text-[11px] font-semibold tabular-nums text-neutral-500 dark:bg-white/[0.08]">
                    {index + 1}
                  </div>
                  <div className={cn('flex h-12 w-12 shrink-0 items-center justify-center rounded-lg', demoSoftTile)}>
                    <HugeiconsIcon icon={ShoppingBag01Icon} size={22} strokeWidth={1.6} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-medium">{product.name}</p>
                    <p className={cn('truncate text-[11px]', demoMutedText)}>
                      {product.orders} transfers - {product.units} confirmed - {product.revenue} LMA
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </SectionCard>
        </Reveal>
      </div>
      <div className="grid w-full max-w-full min-w-0 grid-cols-1 gap-5 xl:grid-cols-[minmax(280px,0.8fr)_minmax(0,1.2fr)]">
        <Reveal index={11}>
          <SectionCard title="Transfer status">
            <div className="grid w-full max-w-full min-w-0 gap-4 sm:grid-cols-[145px_minmax(0,1fr)] xl:grid-cols-1">
              <div className="relative mx-auto flex h-[145px] w-[145px] items-center justify-center rounded-full bg-[conic-gradient(#059669_0_87%,#be6a62_87%_94%,#777_94%_100%)]">
                <div className="flex h-[96px] w-[96px] flex-col items-center justify-center rounded-full bg-[#f4f4f4] text-center dark:bg-[#242424]">
                  <span className="text-xl font-semibold tabular-nums"><LiveNumber value={metrics.totalOrders} /></span>
                  <span className={cn('text-[10px] font-semibold uppercase tracking-[0.08em]', demoMutedText)}>Transfers</span>
                </div>
              </div>
              <div className="space-y-3">
                {demoOperationalRows.map((row) => (
                  <div key={row.label} className={cn('flex items-center justify-between gap-3 rounded-xl px-3 py-2.5', demoSoftTile)}>
                    <div className="flex items-center gap-2.5">
                      <HugeiconsIcon icon={row.icon === 'CheckmarkCircle02Icon' ? CheckmarkCircle02Icon : row.icon === 'Cancel01Icon' ? Cancel01Icon : DeliveryTruck01Icon} size={17} strokeWidth={1.8} />
                      <span className="text-xs font-medium">{row.label}</span>
                    </div>
                    <div className="text-right">
                      <div className="text-xs font-semibold tabular-nums">{row.value}</div>
                      <div className={cn('text-[11px] tabular-nums', demoMutedText)}>{row.percent}%</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </SectionCard>
        </Reveal>
        <Reveal index={12}>
          <SectionCard title="Channel activity">
            <div className="grid w-full max-w-full min-w-0 gap-3 md:grid-cols-2">
              {demoPlatformPerformance.map((platform, index) => (
                <div key={platform.label} className={cn('rounded-xl p-4 transition-colors hover:bg-black/[0.04] dark:hover:bg-white/[0.06]', demoSoftTile)}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/60 dark:bg-black/20">
                        <HugeiconsIcon icon={platform.icon === 'Megaphone01Icon' ? Megaphone01Icon : platform.icon === 'Activity01Icon' ? Activity01Icon : platform.icon === 'StoreLocation01Icon' ? StoreLocation01Icon : ChartBarBigIcon} size={20} strokeWidth={1.8} />
                      </div>
                      <div>
                        <p className="text-xs font-semibold">{platform.label}</p>
                        <p className={cn('text-[11px]', demoMutedText)}>#{index + 1} channel</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-xs font-semibold tabular-nums">{platform.orders}</p>
                      <p className={cn('text-[11px] tabular-nums', demoMutedText)}>{platform.share}%</p>
                    </div>
                  </div>
                  <div className="mt-4 h-2 overflow-hidden rounded-full bg-black/[0.08] dark:bg-white/[0.08]">
                    <div className="h-full rounded-full bg-neutral-900 dark:bg-neutral-100" style={{ width: `${platform.share}%` }} />
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                    <div className="rounded-lg bg-white/55 px-2.5 py-2 dark:bg-black/20">
                      <p className={demoMutedText}>Transfer value</p>
                      <p className="mt-0.5 font-semibold tabular-nums">{platform.value}</p>
                    </div>
                    <div className="rounded-lg bg-white/55 px-2.5 py-2 dark:bg-black/20">
                      <p className={demoMutedText}>Settlement</p>
                      <p className="mt-0.5 font-semibold tabular-nums">{platform.delivery}%</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </SectionCard>
        </Reveal>
      </div>
      <Reveal index={13}>
        <SectionCard title="Latest transfers">
          <OrdersTable orders={[...liveOrders, ...demoOrders].slice(0, 5)} onSelect={onSelectOrder} />
        </SectionCard>
      </Reveal>
      <div className="grid w-full max-w-full min-w-0 grid-cols-1 gap-5 lg:grid-cols-2">
        <Reveal index={14}>
          <SectionCard title="Account">
            <div className="grid w-full max-w-full min-w-0 grid-cols-1 gap-3 sm:grid-cols-3">
              {[
                { label: 'Contacts', value: '12' },
                { label: 'Active', value: '10' },
                { label: 'Checks', value: '8' },
              ].map((item) => (
                <div key={item.label} className={cn('rounded-xl px-3 py-3', demoSoftTile)}>
                  <p className={cn('text-[10px] font-semibold uppercase tracking-[0.08em]', demoMutedText)}>{item.label}</p>
                  <p className="mt-1 text-lg font-semibold tabular-nums">{item.value}</p>
                </div>
              ))}
            </div>
            <div className="mt-4 space-y-2">
              {demoTeam.slice(0, 3).map((member) => (
                <div key={member.name} className={cn('flex items-center justify-between rounded-xl px-3 py-2.5', demoSoftTile)}>
                  <span className="text-xs font-medium">{member.role}</span>
                  <span className="text-xs font-semibold tabular-nums">1</span>
                </div>
              ))}
            </div>
          </SectionCard>
        </Reveal>
        <Reveal index={15}>
          <SectionCard title="Connected services" action={<span className={cn('text-xs font-medium', demoMutedText)}>4 connected</span>}>
            <div className="space-y-3">
              {demoIntegrations.map((integration) => (
                <div key={integration.name} className={cn('flex items-center gap-3 rounded-2xl px-3 py-3 transition-colors hover:bg-black/[0.04] dark:hover:bg-white/[0.06]', demoSoftTile)}>
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/60 dark:bg-black/20">
                    <HugeiconsIcon icon={integration.icon === 'StoreLocation01Icon' ? StoreLocation01Icon : integration.icon === 'Megaphone01Icon' ? Megaphone01Icon : integration.icon === 'DeliveryTruck01Icon' ? DeliveryTruck01Icon : Mail01Icon} size={18} strokeWidth={1.8} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-semibold">{integration.name}</p>
                    <p className={cn('truncate text-[11px]', demoMutedText)}>{integration.detail}</p>
                  </div>
                  <StatusPill label={integration.status} tone={integration.tone} />
                </div>
              ))}
            </div>
          </SectionCard>
        </Reveal>
      </div>
    </div>
  );
}
