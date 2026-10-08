import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { api, ApiError, type ApiCustomAddressState } from "@/shared/api";
import { WalletPage } from "@/app/shell";
import { CustomAddressPage } from "@/features/wallet";
import { pageHead } from "@/shared/lib/platform";
import { useProAccess, useWallet } from "@/shared/hooks";
import { useT } from "@/shared/i18n";
import { PageDataLoader } from "@/shared/ui/page-data-loader";
import { Button } from "@/shared/ui/button";
export const Route = createFileRoute("/custom-address")({
  head: ({ match }) =>
    pageHead(
      "wallet.customAddress.title",
      "wallet.customAddress.description",
      match.context.language,
    ),
  component: CustomAddressRoute,
});

function CustomAddressRoute() {
  return (
    <WalletPage titleKey="wallet.customAddress.title">
      <CustomAddressGate />
    </WalletPage>
  );
}

function CustomAddressGate() {
  const { user, loading } = useWallet();
  const navigate = useNavigate();
  const t = useT("wallet.customAddress");
  const common = useT("common");
  const pro = useProAccess();
  const state = useQuery({
    queryKey: ["account", "custom-address", user?.id],
    queryFn: () => api.get<ApiCustomAddressState>("/api/v1/wallet/custom-address"),
    enabled: typeof window !== "undefined" && !!user && pro,
    staleTime: 0,
    refetchOnMount: "always",
    retry: false,
  });
  const refusalStatus = state.error instanceof ApiError ? state.error.status : null;
  const refused = state.isFetchedAfterMount && (refusalStatus === 401 || refusalStatus === 403);
  useEffect(() => {
    if (refusalStatus === 401 && state.isFetchedAfterMount)
      void navigate({ to: "/login", replace: true });
  }, [refusalStatus, state.isFetchedAfterMount, navigate]);
  useEffect(() => {
    if (loading || !user) return;
    if (!pro || (refused && refusalStatus === 403)) {
      void navigate({ to: "/billing", replace: true });
    }
  }, [loading, user, pro, refused, refusalStatus, navigate]);
  // Re-check even cached successes and refusals before using them on a new visit.
  if (loading || !user) return <PageDataLoader title={t("title")} />;
  if (!pro) return null;
  if (!state.isFetchedAfterMount) return <PageDataLoader title={t("title")} />;
  if (refused && refusalStatus === 401) return null;
  if (refused && refusalStatus === 403) return null;
  if (state.error)
    return (
      <section
        role="alert"
        className="max-w-2xl rounded-[22px] border border-border bg-card p-6 shadow-sm sm:p-8"
      >
        <h2 className="font-display text-xl font-semibold">{t("loadError.title")}</h2>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">{t("loadError.description")}</p>
        <Button
          type="button"
          variant="outline"
          className="mt-5 min-h-11"
          onClick={() => void state.refetch()}
        >
          {common("actions.retry")}
        </Button>
      </section>
    );
  if (!state.data) return <PageDataLoader title={t("title")} />;
  return <CustomAddressPage state={state.data} />;
}
