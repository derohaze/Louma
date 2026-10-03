import type { HugeiconsIcon } from "@hugeicons/react";
import {
  ArrowDownLeft01Icon,
  ArrowUpRight01Icon,
  SecurityCheckIcon,
} from "@hugeicons/core-free-icons";

type IconData = Parameters<typeof HugeiconsIcon>[0]["icon"];

/** Icon per notification kind, so a security notice reads differently from a transfer notice. */
export const notificationKindIcons: Record<string, IconData> = {
  transfer_received: ArrowDownLeft01Icon,
  transfer_sent: ArrowUpRight01Icon,
  security: SecurityCheckIcon,
};
