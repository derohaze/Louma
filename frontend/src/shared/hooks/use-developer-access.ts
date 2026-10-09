import { useQuery } from "@tanstack/react-query";
import { useWallet } from "@/shared/hooks/wallet-context";
import { paymentApi } from "@/shared/api/payments";

/** Visibility follows a server grant. Every dashboard endpoint separately enforces the grant. */
export function useDeveloperAccess() {
  const { userId } = useWallet();
  return useQuery({
    queryKey: ["account", "developer-access", userId],
    queryFn: paymentApi.access,
    enabled: !!userId,
    staleTime: 30_000,
  });
}
