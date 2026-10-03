import { createFileRoute } from "@tanstack/react-router";
import { WalletPage } from "@/app/shell";
import { NotificationsPage } from "@/features/notifications";
import { pageHead } from "@/shared/lib/platform";
export const Route = createFileRoute("/notifications")({
  head: () => pageHead("notifications.title", "notifications.description"),
  component: () => (
    <WalletPage titleKey="notifications.title">
      <NotificationsPage />
    </WalletPage>
  ),
});
