import type { PillTone } from './tokens';
import type { DemoNavItem, DemoNavSection } from './types';

/* ------------------------- page labels ------------------------- */

export type DemoPageKey =
  | 'overview'
  | 'reports'
  | 'analytics'
  | 'seo'
  | 'aeo'
  | 'geo'
  | 'products'
  | 'orders'
  | 'customers'
  | 'shipping'
  | 'team'
  | 'integrations';

export const demoPageLabels: Record<DemoPageKey, string> = {
  overview: 'Overview',
  reports: 'Statements',
  analytics: 'Activity',
  seo: 'Transaction search',
  aeo: 'Mining',
  geo: 'Custom address',
  products: 'Wallet',
  orders: 'Transfers',
  customers: 'Recipients',
  shipping: 'Settlements',
  team: 'Profile',
  integrations: 'Connected services',
};

/* ------------------------ nav sections ------------------------- */

export const demoNavSections: DemoNavSection[] = [
  {
    label: 'Overview',
    items: [{ key: 'overview', label: 'Overview', icon: 'Home01Icon' }],
  },
  {
    label: 'Wallet',
    items: [
      { key: 'reports', label: 'Statements', icon: 'File01Icon' },
      { key: 'analytics', label: 'Activity', icon: 'ChartBarBigIcon' },
      { key: 'seo', label: 'Search', icon: 'ChartBarBigIcon' },
      { key: 'aeo', label: 'Mining', icon: 'Activity01Icon' },
      { key: 'geo', label: 'Address', icon: 'Location01Icon' },
    ],
  },
  {
    label: 'Payments',
    items: [
      { key: 'products', label: 'Wallet', icon: 'Package01Icon' },
      { key: 'orders', label: 'Transfers', icon: 'ShoppingBag01Icon' },
      { key: 'customers', label: 'Recipients', icon: 'UserGroupIcon' },
    ],
  },
  {
    label: 'Settlement',
    items: [{ key: 'shipping', label: 'Settlements', icon: 'ShippingTruck01Icon' }],
  },
  {
    label: 'Account',
    items: [
      { key: 'team', label: 'Profile', icon: 'UserSettings01Icon' },
      { key: 'integrations', label: 'Services', icon: 'Plug01Icon' },
    ],
  },
];

export const demoNavItems = demoNavSections.flatMap((section) => section.items);

/* ---------------------- order data ----------------------- */

export interface DemoOrderItem {
  name: string;
  quantity: number;
  price: string;
}

export interface DemoTimelineEvent {
  label: string;
  time: string;
  done: boolean;
}

export interface DemoOrder {
  code: string;
  product: string;
  customer: string;
  phone: string;
  governorate: string;
  city: string;
  address: string;
  date: string;
  total: string;
  subtotal: string;
  shippingFee: string;
  payment: string;
  status: string;
  tone: PillTone;
  items: DemoOrderItem[];
  timeline: DemoTimelineEvent[];
}

export const demoOrders: DemoOrder[] = [
  {
    code: '#LM-1861', product: 'Rent share', customer: 'Salma Adel', phone: '+20 100 ••• 4821',
    governorate: 'Cairo', city: 'Nasr City', address: '14 Abbas El Akkad St., Apt 7',
    date: 'Jul 4, 11:20', total: '1,450', subtotal: '1,395', shippingFee: '55', payment: 'Standard',
    status: 'Confirmed', tone: 'success',
    items: [{ name: 'Rent share — March', quantity: 1, price: '1,395' }],
    timeline: [
      { label: 'Transfer created', time: 'Jul 4, 11:20', done: true },
      { label: 'Risk check passed', time: 'Jul 4, 11:21', done: true },
      { label: 'Confirmed by you', time: 'Jul 4, 11:34', done: true },
      { label: 'Awaiting confirmation', time: '—', done: false },
    ],
  },
  {
    code: '#LM-1858', product: 'Coffee split', customer: 'Ahmed Hassan', phone: '+20 111 ••• 0932',
    governorate: 'Giza', city: 'Dokki', address: '3 Tahrir St., Floor 5',
    date: 'Jul 4, 10:52', total: '620', subtotal: '570', shippingFee: '50', payment: 'Priority',
    status: 'Pending', tone: 'progress',
    items: [{ name: 'Coffee split — shared', quantity: 1, price: '570' }],
    timeline: [
      { label: 'Transfer created', time: 'Jul 4, 10:52', done: true },
      { label: 'Risk check passed', time: 'Jul 4, 10:53', done: true },
      { label: 'Confirmation pending', time: 'In queue', done: false },
    ],
  },
  {
    code: '#LM-1854', product: 'Top-up', customer: 'Omar Farouk', phone: '+20 122 ••• 5518',
    governorate: 'Cairo', city: 'Maadi', address: '22 Road 9, Villa 4',
    date: 'Jul 4, 09:47', total: '890', subtotal: '830', shippingFee: '60', payment: 'Standard',
    status: 'Settling', tone: 'neutral',
    items: [
      { name: 'Top-up — instant', quantity: 1, price: '490' },
      { name: 'Top-up — scheduled', quantity: 1, price: '340' },
    ],
    timeline: [
      { label: 'Transfer created', time: 'Jul 4, 09:47', done: true },
      { label: 'Confirmed by you', time: 'Jul 4, 10:02', done: true },
      { label: 'Settlement started', time: 'Jul 4, 13:15', done: true },
      { label: 'Settling', time: '—', done: false },
    ],
  },
  {
    code: '#LM-1849', product: 'Birthday gift', customer: 'Nour ElSayed', phone: '+20 106 ••• 2210',
    governorate: 'Alexandria', city: 'Smouha', address: '8 Fawzi Moaz St.',
    date: 'Jul 3, 18:31', total: '540', subtotal: '475', shippingFee: '65', payment: 'Internal',
    status: 'Settled', tone: 'success',
    items: [{ name: 'Birthday gift — Nour', quantity: 1, price: '475' }],
    timeline: [
      { label: 'Transfer created', time: 'Jul 3, 18:31', done: true },
      { label: 'Confirmed by you', time: 'Jul 3, 18:50', done: true },
      { label: 'Settlement started', time: 'Jul 4, 09:10', done: true },
      { label: 'Settled', time: 'Jul 4, 15:42', done: true },
    ],
  },
  {
    code: '#LM-1846', product: 'Savings', customer: 'Mariam Khaled', phone: '+20 109 ••• 3308',
    governorate: 'Cairo', city: 'Heliopolis', address: '31 El Hegaz St., Apt 12',
    date: 'Jul 3, 16:05', total: '380', subtotal: '330', shippingFee: '50', payment: 'Standard',
    status: 'Review', tone: 'warning',
    items: [{ name: 'Savings — weekly', quantity: 1, price: '330' }],
    timeline: [
      { label: 'Transfer created', time: 'Jul 3, 16:05', done: true },
      { label: 'Risk check flagged', time: 'Jul 3, 17:20', done: true },
      { label: 'Review scheduled', time: 'Jul 5, 12:00', done: false },
    ],
  },
  {
    code: '#LM-1840', product: 'Utilities', customer: 'Youssef Nabil', phone: '+20 128 ••• 7754',
    governorate: 'Dakahlia', city: 'Mansoura', address: '5 Gomhouria St.',
    date: 'Jul 3, 12:14', total: '1,120', subtotal: '1,050', shippingFee: '70', payment: 'Priority',
    status: 'Settled', tone: 'success',
    items: [{ name: 'Utilities — March', quantity: 1, price: '1,050' }],
    timeline: [
      { label: 'Transfer created', time: 'Jul 3, 12:14', done: true },
      { label: 'Confirmed by you', time: 'Jul 3, 12:30', done: true },
      { label: 'Settled', time: 'Jul 4, 14:05', done: true },
    ],
  },
  {
    code: '#LM-1833', product: 'Reversal', customer: 'Hana Mostafa', phone: '+20 101 ••• 6642',
    governorate: 'Giza', city: '6th of October', address: 'District 7, Building 14',
    date: 'Jul 2, 20:40', total: '760', subtotal: '700', shippingFee: '60', payment: 'Standard',
    status: 'Reversed', tone: 'danger',
    items: [{ name: 'Reversal — full amount', quantity: 1, price: '700' }],
    timeline: [
      { label: 'Transfer created', time: 'Jul 2, 20:40', done: true },
      { label: 'Recipient requested reversal', time: 'Jul 3, 09:12', done: true },
      { label: 'Reversed by you', time: 'Jul 3, 09:15', done: true },
    ],
  },
];

/* --------------------- products data ---------------------- */

export const demoProducts = [
  { name: 'Main address', sku: 'LMA-114', price: '1,450', stock: 42, status: 'Active', tone: 'success' as PillTone },
  { name: 'Savings address', sku: 'LMA-231', price: '890', stock: 18, status: 'Active', tone: 'success' as PillTone },
  { name: 'Business address', sku: 'LMA-078', price: '620', stock: 6, status: 'Low balance', tone: 'warning' as PillTone },
  { name: 'Gift address', sku: 'LMA-102', price: '540', stock: 64, status: 'Active', tone: 'success' as PillTone },
  { name: 'Cold storage', sku: 'LMA-097', price: '380', stock: 0, status: 'Empty', tone: 'danger' as PillTone },
];

/* -------------------- customers data ---------------------- */

export const demoCustomers = [
  { name: 'Salma Adel', phone: '+20 100 ••• 4821', governorate: 'Cairo', orders: 9, spent: '8,940' },
  { name: 'Ahmed Hassan', phone: '+20 111 ••• 0932', governorate: 'Giza', orders: 4, spent: '3,120' },
  { name: 'Nour ElSayed', phone: '+20 106 ••• 2210', governorate: 'Alexandria', orders: 7, spent: '5,480' },
  { name: 'Youssef Nabil', phone: '+20 128 ••• 7754', governorate: 'Mansoura', orders: 2, spent: '1,760' },
  { name: 'Mariam Khaled', phone: '+20 109 ••• 3308', governorate: 'Cairo', orders: 5, spent: '4,215' },
];

/* -------------------- workspaces data --------------------- */

export const demoWorkspaces = [
  { name: 'Personal', role: 'Owner account' },
  { name: 'Family', role: 'Owner account' },
  { name: 'Business', role: 'Shared account' },
];

/* ------------------ notifications data -------------------- */

export const demoNotifications = [
  { icon: 'ShoppingBag01Icon' as const, title: 'New transfer #LM-1861', detail: 'Salma Adel · 1,450 LMA', time: '2m ago' },
  { icon: 'Package01Icon' as const, title: 'Low balance warning', detail: 'Main address — 6 LMA left', time: '26m ago' },
  { icon: 'DeliveryTruck01Icon' as const, title: 'Settlement started', detail: '#LM-1854 · standard', time: '1h ago' },
];

/* -------------------- revenue trend ----------------------- */

export const demoRevenueTrend = [
  { label: 'Jan', revenue: 312, orders: 640 },
  { label: 'Feb', revenue: 358, orders: 720 },
  { label: 'Mar', revenue: 341, orders: 690 },
  { label: 'Apr', revenue: 402, orders: 810 },
  { label: 'May', revenue: 445, orders: 902 },
  { label: 'Jun', revenue: 489, orders: 1120 },
  { label: 'Jul', revenue: 529, orders: 1284 },
];

/* ------------------- traffic sources ---------------------- */

export const demoTrafficSources = [
  { label: 'Incoming', share: 42, detail: '1,433 transfers' },
  { label: 'Outgoing', share: 27, detail: '921 transfers' },
  { label: 'Mining rewards', share: 18, detail: '614 transfers' },
  { label: 'Address receives', share: 9, detail: '307 transfers' },
  { label: 'App transfers', share: 4, detail: '137 transfers' },
];

/* ------------------- pulse metrics ------------------------ */

export const demoPulseMetrics = [
  { label: 'New recipients', value: '187', detail: '19.4% of recipients', accent: '+12%' },
  { label: 'Repeat recipients', value: '642', detail: '18.8% repeat rate', accent: '+4%' },
  { label: 'Transfers / recipient', value: '1.4', detail: '1,284 tracked transfers', accent: '87%' },
  { label: 'Settled transfers', value: '1,118', detail: '87.1% settlement rate', accent: '+6%' },
  { label: 'Reversed transfers', value: '44', detail: '3.4% reversal rate', accent: '-1%' },
  { label: 'Failed transfers', value: '86', detail: '6.7% failure rate', accent: '-3%' },
];

/* -------------------- top products ------------------------ */

export const demoTopProducts = [
  { name: 'Salma Adel', orders: 186, units: 211, revenue: '269K' },
  { name: 'Ahmed Hassan', orders: 154, units: 228, revenue: '137K' },
  { name: 'Nour ElSayed', orders: 121, units: 136, revenue: '75K' },
  { name: 'Youssef Nabil', orders: 98, units: 104, revenue: '53K' },
];

/* ---------------- platform performance -------------------- */

export const demoPlatformPerformance = [
  { label: 'Incoming', orders: 512, share: 40, delivery: 88, value: '219K', icon: 'Megaphone01Icon' as const },
  { label: 'Outgoing', orders: 328, share: 26, delivery: 84, value: '141K', icon: 'Activity01Icon' as const },
  { label: 'Mining', orders: 241, share: 19, delivery: 91, value: '103K', icon: 'StoreLocation01Icon' as const },
  { label: 'Address', orders: 203, share: 15, delivery: 86, value: '66K', icon: 'ChartBarBigIcon' as const },
];

/* ----------------- operational rows ----------------------- */

export const demoOperationalRows = [
  { label: 'Settled', value: 1118, percent: 87, icon: 'CheckmarkCircle02Icon' as const },
  { label: 'Failed', value: 86, percent: 7, icon: 'Cancel01Icon' as const },
  { label: 'Reversed', value: 44, percent: 3, icon: 'DeliveryTruck01Icon' as const },
];

/* ------------------- search audits ------------------------ */

export const demoSearchAudits = [
  { url: '#LM-1861', time: 'Today, 11:24', score: 86 },
  { url: '#LM-1854', time: 'Yesterday, 18:10', score: 74 },
  { url: '#LM-1840', time: 'Jun 30, 09:42', score: 91 },
];

/* -------------------- seo / aeo / geo --------------------- */

export const demoSeoChecks = [
  { label: 'Query coverage', value: 'Healthy', tone: 'success' as PillTone },
  { label: 'Index freshness', value: 'Needs reindexing', tone: 'warning' as PillTone },
  { label: 'Address index', value: 'Indexed', tone: 'success' as PillTone },
  { label: 'Linked transfers', value: '14 linked transfers', tone: 'neutral' as PillTone },
];

export const demoAeoChecks = [
  { label: 'Hashrate', value: 'Steady across cycles', tone: 'success' as PillTone },
  { label: 'Uptime', value: '3 cycles missed', tone: 'success' as PillTone },
  { label: 'Payout address', value: 'Main address set', tone: 'neutral' as PillTone },
  { label: 'Cycle timing', value: 'Drifting by 4%', tone: 'warning' as PillTone },
];

export const demoGeoChecks = [
  { label: 'QR code', value: 'Generated and ready', tone: 'success' as PillTone },
  { label: 'Address label', value: 'Set and memorable', tone: 'neutral' as PillTone },
  { label: 'Shared with', value: '2 contacts need review', tone: 'warning' as PillTone },
  { label: 'Payment readiness', value: 'Ready to receive', tone: 'success' as PillTone },
];

/* -------------------- shipments --------------------------- */

export const demoShipments = [
  { code: '#LM-1854', courier: 'Standard', destination: 'Salma Adel', status: 'Settling', tone: 'neutral' as PillTone },
  { code: '#LM-1852', courier: 'Priority', destination: 'Ahmed Hassan', status: 'Confirming', tone: 'neutral' as PillTone },
  { code: '#LM-1849', courier: 'Priority', destination: 'Nour ElSayed', status: 'Settled', tone: 'success' as PillTone },
  { code: '#LM-1845', courier: 'Standard', destination: 'Omar Farouk', status: 'Failed', tone: 'danger' as PillTone },
  { code: '#LM-1840', courier: 'Instant', destination: 'Youssef Nabil', status: 'Settled', tone: 'success' as PillTone },
];

/* ----------------------- team ----------------------------- */

export const demoTeam = [
  { name: 'Omar Sherif', role: 'Account holder', status: 'Active', tone: 'success' as PillTone, initials: 'OS' },
  { name: 'Mona Tarek', role: 'Recovery contact', status: 'Active', tone: 'success' as PillTone, initials: 'MT' },
  { name: 'Karim Adel', role: 'Trusted contact', status: 'Active', tone: 'success' as PillTone, initials: 'KA' },
  { name: 'Laila Samir', role: 'Trusted contact', status: 'Active', tone: 'success' as PillTone, initials: 'LS' },
  { name: 'Hassan Omar', role: 'Trusted contact', status: 'Invited', tone: 'warning' as PillTone, initials: 'HO' },
];

/* -------------------- integrations ------------------------ */

export const demoIntegrations = [
  { name: 'Ledger', detail: 'Balance & address sync', status: 'Connected', tone: 'success' as PillTone, icon: 'StoreLocation01Icon' as const },
  { name: 'MetaMask', detail: 'Transfer signing', status: 'Connected', tone: 'success' as PillTone, icon: 'Megaphone01Icon' as const },
  { name: 'Bridge', detail: 'Settlement & confirmations', status: 'Connected', tone: 'success' as PillTone, icon: 'DeliveryTruck01Icon' as const },
  { name: 'Mailchimp', detail: 'Receipt emails', status: 'Not connected', tone: 'neutral' as PillTone, icon: 'Mail01Icon' as const },
];

/* ------------------- order filters ------------------------ */

export const orderFilters = ['All', 'Pending', 'Confirmed', 'Settling', 'Settled', 'Reversed'] as const;
