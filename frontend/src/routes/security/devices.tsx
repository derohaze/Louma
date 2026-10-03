import { createFileRoute } from "@tanstack/react-router";
import { WalletPage } from "@/app/shell";
import { DevicesPage } from "@/features/security";
import { securityDevices } from "@/shared/lib/security";
import { pageHead } from "@/shared/lib/platform";

const page = securityDevices;

export const Route = createFileRoute("/security/devices")({
  head: ({ match }) => pageHead(page.titleKey, page.descriptionKey, match.context.language),
  component: () => (
    <WalletPage titleKey={page.titleKey}>
      <DevicesPage />
    </WalletPage>
  ),
});
