'use client';

import { useState } from 'react';
import { cn } from '@/lib/cn';
import { demoMutedText } from './tokens';
import { demoPageLabels, type DemoPageKey, type DemoOrder } from './data';
import {
  OverviewDemoPage,
  OrdersDemoPage,
  ProductsDemoPage,
  CustomersDemoPage,
  ReportsDemoPage,
  AnalyticsDemoPage,
  SeoDemoPage,
  AeoDemoPage,
  GeoDemoPage,
  ShippingDemoPage,
  TeamDemoPage,
  IntegrationsDemoPage,
} from './pages';
import { DemoSidebar, NotificationsMenu, MobileDemoBottomNav } from './shell';
import { OrderDetailSheet } from './shared';
import { LiveActivityProvider, DemoToastViewport } from './live-activity';

export function DashboardDemo() {
  const [page, setPage] = useState<DemoPageKey>('overview');
  const [mobileMoreOpen, setMobileMoreOpen] = useState(false);
  const [selectedOrder, setSelectedOrder] = useState<DemoOrder | null>(null);
  const navigateDemoPage = (nextPage: DemoPageKey) => {
    setPage(nextPage);
    setMobileMoreOpen(false);
    setSelectedOrder(null);
  };

  const pageContent =
    page === 'overview' ? (
      <OverviewDemoPage onSelectOrder={setSelectedOrder} />
    ) : page === 'orders' ? (
      <OrdersDemoPage onSelectOrder={setSelectedOrder} />
    ) : page === 'products' ? (
      <ProductsDemoPage />
    ) : page === 'customers' ? (
      <CustomersDemoPage />
    ) : page === 'reports' ? (
      <ReportsDemoPage />
    ) : page === 'analytics' ? (
      <AnalyticsDemoPage />
    ) : page === 'seo' ? (
      <SeoDemoPage />
    ) : page === 'aeo' ? (
      <AeoDemoPage />
    ) : page === 'geo' ? (
      <GeoDemoPage />
    ) : page === 'shipping' ? (
      <ShippingDemoPage />
    ) : page === 'team' ? (
      <TeamDemoPage />
    ) : (
      <IntegrationsDemoPage />
    );

  return (
    <LiveActivityProvider>
    <div className="mx-auto w-full max-w-[390px] overflow-hidden rounded-xl bg-white text-neutral-900 shadow-none dark:bg-[#101010] dark:text-neutral-100 sm:max-w-full lg:max-w-[1060px]">
      <div className="relative flex h-9 shrink-0 items-center bg-white px-4 dark:bg-[#101010]">
        <div className="flex items-center gap-2">
          <span className="size-3 rounded-full bg-[#ff5f57]" />
          <span className="size-3 rounded-full bg-[#ffbd2e]" />
          <span className="size-3 rounded-full bg-[#28c840]" />
        </div>
        <p className="absolute inset-x-0 text-center text-xs font-medium text-neutral-600 dark:text-neutral-400">
          Louma Dashboard
        </p>
      </div>

      <div className="flex h-[660px] w-full max-w-full min-w-0 overflow-hidden bg-white text-sm text-neutral-900 sm:h-[530px] lg:h-[500px] dark:bg-[#101010] dark:text-neutral-100">
        <DemoSidebar page={page} onNavigate={navigateDemoPage} />

        <div className="flex w-full max-w-full min-w-0 flex-1 flex-col px-0 pb-2 pt-2 sm:px-2 lg:ps-0 lg:pe-3 lg:pt-3">
          <main className="relative flex min-h-0 w-full max-w-full min-w-0 flex-1 flex-col overflow-hidden rounded-[1rem] bg-white shadow-none sm:rounded-[1.35rem] dark:bg-[#101010] dark:text-neutral-100">
            <header className="flex h-12 shrink-0 items-center justify-between px-3 sm:px-4">
              <div className="flex min-w-0 items-center gap-1.5 text-xs font-medium sm:text-[13px]">
                <span className={demoMutedText}>Dashboard</span>
                <span className="text-neutral-400 dark:text-neutral-500">/</span>
                <span className="truncate">{demoPageLabels[page]}</span>
              </div>
              <NotificationsMenu />
            </header>

            <div key={page} className="no-scrollbar min-h-0 w-full max-w-full min-w-0 flex-1 overflow-x-hidden overflow-y-hidden p-3 pb-24 sm:p-4 md:p-5 lg:overflow-y-auto lg:pb-5">
              {pageContent}
            </div>

            {page === 'overview' && <DemoToastViewport />}
            <OrderDetailSheet order={selectedOrder} onClose={() => setSelectedOrder(null)} />
            <MobileDemoBottomNav
              page={page}
              moreOpen={mobileMoreOpen}
              onNavigate={navigateDemoPage}
              onToggleMore={() => setMobileMoreOpen((open) => !open)}
            />
          </main>
        </div>
      </div>
    </div>
    </LiveActivityProvider>
  );
}
