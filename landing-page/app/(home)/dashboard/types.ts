import type { DemoPageKey } from './data';

export type DemoIcon =
  | 'Home01Icon'
  | 'File01Icon'
  | 'ChartBarBigIcon'
  | 'Activity01Icon'
  | 'Location01Icon'
  | 'Package01Icon'
  | 'ShoppingBag01Icon'
  | 'UserGroupIcon'
  | 'ShippingTruck01Icon'
  | 'UserSettings01Icon'
  | 'Plug01Icon'
  | 'DeliveryTruck01Icon'
  | 'Megaphone01Icon'
  | 'StoreLocation01Icon'
  | 'CheckmarkCircle02Icon'
  | 'Cancel01Icon'
  | 'BellIcon'
  | 'Mail01Icon'
  | 'Settings01Icon'
  | 'SecurityCheckIcon'
  | 'Moon01Icon'
  | 'Logout01Icon'
  | 'CreditCardIcon'
  | 'MoreHorizontalCircle01Icon';

export interface DemoNavItem {
  key: DemoPageKey;
  label: string;
  icon: DemoIcon;
}

export interface DemoNavSection {
  label: string;
  items: DemoNavItem[];
}
