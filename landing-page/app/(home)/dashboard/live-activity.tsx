'use client';

import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { HugeiconsIcon } from '@hugeicons/react';
import {
  CheckmarkCircle02Icon,
  DeliveryTruck01Icon,
  ShoppingBag01Icon,
  UserGroupIcon,
} from '@hugeicons/core-free-icons';
import { cn } from '@/lib/cn';
import { demoMutedText, demoSoftTile } from './tokens';
import { demoNotifications, type DemoOrder } from './data';

/* ------------------------- Live metrics ------------------------- */

export interface LiveMetrics {
  totalOrders: number;
  deliveredOrders: number;
  grossValue: number;
  customers: number;
  /** Customers who ordered in the last 30 days — the "964 customers" figure. */
  activeCustomers: number;
  newCustomers: number;
  repeatCustomers: number;
}

/** Matches the static copy used across the rest of the demo. */
const initialMetrics: LiveMetrics = {
  totalOrders: 1284,
  deliveredOrders: 1118,
  grossValue: 528940,
  customers: 3412,
  activeCustomers: 964,
  newCustomers: 187,
  repeatCustomers: 642,
};

interface DemoToast {
  id: number;
  title: string;
  detail: string;
  icon: typeof ShoppingBag01Icon;
  leaving: boolean;
}

export interface LiveNotification {
  icon: 'ShoppingBag01Icon' | 'Package01Icon' | 'DeliveryTruck01Icon';
  title: string;
  detail: string;
  time: string;
}

interface LiveActivityValue {
  metrics: LiveMetrics;
  toasts: DemoToast[];
  /** Fresh scripted orders, newest first — Orders/Overview tables prepend these. */
  liveOrders: DemoOrder[];
  /** Bell menu feed: live events stack on top of the static seed rows. */
  notifications: LiveNotification[];
  unreadCount: number;
  /** Opening the bell menu clears the badge, like the real dashboard. */
  markNotificationsRead: () => void;
}

const LiveActivityContext = createContext<LiveActivityValue>({
  metrics: initialMetrics,
  toasts: [],
  liveOrders: [],
  notifications: demoNotifications,
  unreadCount: demoNotifications.length,
  markNotificationsRead: () => {},
});

export function useLiveActivity() {
  return useContext(LiveActivityContext);
}

/* ------------------------- Event script ------------------------- */

/**
 * Scripted activity feed: each event both shows a toast and mutates the
 * metrics, so the toast and the number animation always tell the same story.
 * Deterministic (index-based) so the demo replays identically for everyone.
 */
/** Builds a full order record for the Orders table from a scripted event. */
function scriptedOrder(
  code: string,
  product: string,
  customer: string,
  governorate: string,
  city: string,
  total: number,
  payment: 'Standard' | 'Priority',
): DemoOrder {
  const subtotal = total - 55;
  return {
    code,
    product,
    customer,
    phone: '+20 10• ••• ••00',
    governorate,
    city,
    address: 'Address shared after confirmation',
    date: 'Just now',
    total: total.toLocaleString('en-US'),
    subtotal: subtotal.toLocaleString('en-US'),
    shippingFee: '55',
    payment,
    status: 'Pending',
    tone: 'progress',
    items: [{ name: product, quantity: 1, price: subtotal.toLocaleString('en-US') }],
    timeline: [
      { label: 'Transfer created', time: 'Just now', done: true },
      { label: 'Risk check passed', time: 'Just now', done: true },
      { label: 'Confirmation pending', time: 'In queue', done: false },
    ],
  };
}

const activityScript: Array<{
  title: string;
  detail: string;
  icon: typeof ShoppingBag01Icon;
  bellIcon: LiveNotification['icon'];
  orderValue?: number;
  delivered?: boolean;
  newCustomer?: boolean;
  repeatCustomer?: boolean;
  order?: DemoOrder;
}> = [
  {
    title: 'New transfer #LM-1862', detail: 'Salma Adel · 1,450 LMA', icon: ShoppingBag01Icon, bellIcon: 'ShoppingBag01Icon',
    orderValue: 1450, newCustomer: true,
    order: scriptedOrder('#LM-1862', 'Rent share', 'Salma Adel', 'Cairo', 'Nasr City', 1450, 'Standard'),
  },
  { title: 'Transfer settled', detail: '#LM-1840 · settlement complete', icon: CheckmarkCircle02Icon, bellIcon: 'DeliveryTruck01Icon', delivered: true },
  {
    title: 'New transfer #LM-1863', detail: 'Karim Nabil · 640 LMA', icon: ShoppingBag01Icon, bellIcon: 'ShoppingBag01Icon',
    orderValue: 640, repeatCustomer: true,
    order: scriptedOrder('#LM-1863', 'Coffee split', 'Karim Nabil', 'Giza', 'Dokki', 640, 'Priority'),
  },
  { title: 'Settlement started', detail: '#LM-1858 · standard', icon: DeliveryTruck01Icon, bellIcon: 'DeliveryTruck01Icon' },
  {
    title: 'New transfer #LM-1864', detail: 'Mona Hassan · 890 LMA', icon: ShoppingBag01Icon, bellIcon: 'ShoppingBag01Icon',
    orderValue: 890, newCustomer: true,
    order: scriptedOrder('#LM-1864', 'Top-up', 'Mona Hassan', 'Alexandria', 'Smouha', 890, 'Standard'),
  },
  { title: 'Transfer settled', detail: '#LM-1844 · settlement complete', icon: CheckmarkCircle02Icon, bellIcon: 'DeliveryTruck01Icon', delivered: true },
  { title: 'New recipient added', detail: 'Youssef Omar · added from wallet', icon: UserGroupIcon, bellIcon: 'Package01Icon', newCustomer: true },
  {
    title: 'New transfer #LM-1865', detail: 'Nour Said · 1,120 LMA', icon: ShoppingBag01Icon, bellIcon: 'ShoppingBag01Icon',
    orderValue: 1120, repeatCustomer: true,
    order: scriptedOrder('#LM-1865', 'Gift', 'Nour Said', 'Dakahlia', 'Mansoura', 1120, 'Standard'),
  },
];

const TICK_MS = 3600;
const TOAST_LIFETIME_MS = 4200;
const TOAST_EXIT_MS = 300;
/** Toasts stop after this many appearances; metrics keep updating forever. */
const MAX_TOAST_APPEARANCES = 4;
/** Cap the prepended live orders so the table doesn't grow unboundedly. */
const MAX_LIVE_ORDERS = 4;
const MAX_LIVE_NOTIFICATIONS = 5;

/* ------------------------- Provider ------------------------- */

export function LiveActivityProvider({ children }: { children: ReactNode }) {
  const [metrics, setMetrics] = useState<LiveMetrics>(initialMetrics);
  const [toasts, setToasts] = useState<DemoToast[]>([]);
  const [liveOrders, setLiveOrders] = useState<DemoOrder[]>([]);
  const [notifications, setNotifications] = useState<LiveNotification[]>(demoNotifications);
  const [unreadCount, setUnreadCount] = useState(demoNotifications.length);
  const containerRef = useRef<HTMLDivElement>(null);
  const [isVisible, setIsVisible] = useState(false);

  // Only animate while the demo is actually on screen — no background churn.
  // The wrapper is display:contents (no box of its own), so observe the real
  // demo element inside it instead.
  useEffect(() => {
    const target = containerRef.current?.firstElementChild;
    if (!target) return;
    const observer = new IntersectionObserver(
      ([entry]) => setIsVisible(entry.isIntersecting),
      { threshold: 0.1 },
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!isVisible) return;
    let eventIndex = 0;
    let nextToastId = 1;
    const timers = new Set<number>();

    const runNextEvent = () => {
      const event = activityScript[eventIndex % activityScript.length];
      eventIndex += 1;

      setMetrics((current) => ({
        totalOrders: current.totalOrders + (event.orderValue ? 1 : 0),
        deliveredOrders: current.deliveredOrders + (event.delivered ? 1 : 0),
        grossValue: current.grossValue + (event.orderValue ?? 0),
        customers: current.customers + (event.newCustomer ? 1 : 0),
        activeCustomers: current.activeCustomers + (event.newCustomer ? 1 : 0),
        newCustomers: current.newCustomers + (event.newCustomer ? 1 : 0),
        repeatCustomers: current.repeatCustomers + (event.repeatCustomer ? 1 : 0),
      }));

      if (event.order) {
        const newOrder = event.order;
        setLiveOrders((current) =>
          [newOrder, ...current.filter((order) => order.code !== newOrder.code)].slice(0, MAX_LIVE_ORDERS),
        );
      }

      // Every event lands in the bell menu and bumps the unread badge.
      setNotifications((current) =>
        [
          { icon: event.bellIcon, title: event.title, detail: event.detail, time: 'Just now' },
          ...current,
        ].slice(0, MAX_LIVE_NOTIFICATIONS),
      );
      setUnreadCount((current) => current + 1);

      // Toasts are a teaser, not a firehose: after a few appearances they stop
      // while the metrics and tables keep moving.
      if (nextToastId > MAX_TOAST_APPEARANCES) return;
      const toastId = nextToastId;
      nextToastId += 1;
      setToasts((current) => [
        ...current.slice(-2),
        { id: toastId, title: event.title, detail: event.detail, icon: event.icon, leaving: false },
      ]);

      // Two-phase dismiss: mark as leaving (slide-out plays), then unmount.
      timers.add(
        window.setTimeout(() => {
          setToasts((current) =>
            current.map((toast) => (toast.id === toastId ? { ...toast, leaving: true } : toast)),
          );
          timers.add(
            window.setTimeout(() => {
              setToasts((current) => current.filter((toast) => toast.id !== toastId));
            }, TOAST_EXIT_MS),
          );
        }, TOAST_LIFETIME_MS),
      );
    };

    // First event lands fast so the demo feels alive right away; the interval
    // keeps the feed going from there.
    const firstTick = window.setTimeout(runNextEvent, 1200);
    const interval = window.setInterval(runNextEvent, TICK_MS);

    return () => {
      window.clearTimeout(firstTick);
      window.clearInterval(interval);
      timers.forEach((timer) => window.clearTimeout(timer));
    };
  }, [isVisible]);

  const markNotificationsRead = () => setUnreadCount(0);

  return (
    <LiveActivityContext.Provider
      value={{ metrics, toasts, liveOrders, notifications, unreadCount, markNotificationsRead }}
    >
      <div ref={containerRef} className="contents">
        {children}
      </div>
    </LiveActivityContext.Provider>
  );
}

/* ------------------------- Toast viewport ------------------------- */

/**
 * In-demo toast stack, bottom-right of the dashboard window — same recipe as
 * the real app's toasts (bordered card, title + description, slide-in), scaled
 * down to the demo's type ramp.
 */
export function DemoToastViewport() {
  const { toasts } = useLiveActivity();

  return (
    <div
      aria-live="polite"
      className="pointer-events-none absolute bottom-20 right-3 z-30 flex w-[240px] flex-col gap-2 sm:bottom-4 sm:right-4 sm:w-[264px]"
    >
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={cn(
            'flex items-start gap-2.5 rounded-xl border bg-white/95 p-3 shadow-lg backdrop-blur-sm transition-all duration-300 ease-[cubic-bezier(0.4,0,0.2,1)] dark:bg-neutral-900/95',
            toast.leaving
              ? 'translate-x-4 opacity-0'
              : 'animate-in fade-in slide-in-from-bottom-3 fill-mode-both duration-400',
          )}
        >
          <span className={cn('flex h-8 w-8 shrink-0 items-center justify-center rounded-lg', demoSoftTile)}>
            <HugeiconsIcon icon={toast.icon} size={15} strokeWidth={1.8} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-xs font-semibold">{toast.title}</span>
            <span className={cn('block truncate text-[11px]', demoMutedText)}>{toast.detail}</span>
          </span>
        </div>
      ))}
    </div>
  );
}
