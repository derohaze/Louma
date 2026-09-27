import { createFileRoute } from "@tanstack/react-router";
import { WalletPage } from "@/components/wallet-shell";
import { DevicesContent } from "@/components/security-features";
import { securityDevices } from "@/lib/security-catalog";
import { pageHead } from "@/lib/page-head";

const page = securityDevices;

export const Route = createFileRoute("/security/devices")({
  head: () => pageHead(page.title, page.description),
  component: () => (
    <WalletPage title={page.title}>
      <DevicesContent />
    </WalletPage>
  ),
});
