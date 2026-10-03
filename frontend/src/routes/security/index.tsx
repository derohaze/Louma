import { createFileRoute } from "@tanstack/react-router";
import { WalletPage } from "@/app/shell";
import { SecurityCenterContent } from "@/features/security";
import { securityCenter } from "@/shared/lib/security";
import { pageHead } from "@/shared/lib/platform";

export const Route = createFileRoute("/security/")({
  head: () => pageHead(securityCenter.titleKey, securityCenter.descriptionKey),
  component: () => (
    <WalletPage titleKey={securityCenter.titleKey}>
      <SecurityCenterContent />
    </WalletPage>
  ),
});
