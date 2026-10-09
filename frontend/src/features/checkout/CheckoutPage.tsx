import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { api, ApiError, messageForError, type ApiSecurityOverview } from "@/shared/api";
import { paymentApi, type CheckoutDetails, type PaymentMode } from "@/shared/api/payments";
import { useT } from "@/shared/i18n";
import { Button } from "@/shared/ui/button";
import { CheckoutExperience, CheckoutShell, type CheckoutProof } from "./CheckoutExperience";

export function CheckoutPage({ session, mode }: { session: string; mode: PaymentMode }) {
  const t = useT("checkout");
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [subscriptionCanceled, setSubscriptionCanceled] = useState(false);
  const [requestKey] = useState(() => crypto.randomUUID());
  const queryKey = ["account", "checkout", mode, session];
  const checkout = useQuery({
    queryKey,
    queryFn: () => paymentApi.checkout(mode, session),
    enabled: typeof window !== "undefined",
  });
  const security = useQuery({
    queryKey: ["account", "checkout-security"],
    queryFn: () => api.get<ApiSecurityOverview>("/api/v1/security"),
    enabled: !!checkout.data,
  });
  const payment = checkout.data;
  const cancelSubscription = async () => {
    if (!payment?.subscription_id) return;
    setBusy(true);
    setError("");
    try {
      await paymentApi.cancelSubscription(mode, payment.subscription_id, requestKey);
      setSubscriptionCanceled(true);
    } catch (failure) {
      setError(messageForError(failure));
    } finally {
      setBusy(false);
    }
  };
  const confirm = async (proof: CheckoutProof): Promise<boolean> => {
    if (!payment) return false;
    setBusy(true);
    setError("");
    try {
      const settled = await paymentApi.confirm(mode, session, proof, requestKey);
      // Go's settlement response is authoritative; re-read display details separately.
      queryClient.setQueryData<CheckoutDetails>(queryKey, { ...payment, ...settled });
      await checkout.refetch();
      return true;
    } catch (failure) {
      setError(messageForError(failure));
      // A lost response can follow a committed payment. Keep the key and ask the durable record.
      await checkout.refetch();
      return false;
    } finally {
      setBusy(false);
    }
  };
  return (
    <CheckoutShell>
      {!payment ? (
        <div className="space-y-4 p-7">
          <h1 id="checkout-heading" className="font-display text-xl font-semibold">
            {t("title")}
          </h1>
          {checkout.isPending && (
            <p role="status" className="text-sm text-muted-foreground">
              {t("loading")}
            </p>
          )}
          {checkout.error instanceof ApiError && checkout.error.status === 401 ? (
            <>
              <p className="text-sm text-muted-foreground">{t("signInHint")}</p>
              <Button asChild className="min-h-12 w-full">
                <Link to="/login" search={{ checkout: session, mode }}>
                  {t("signIn")}
                </Link>
              </Button>
            </>
          ) : (
            checkout.error && (
              <>
                <p role="alert" className="text-sm text-destructive">
                  {messageForError(checkout.error)}
                </p>
                <Button
                  variant="outline"
                  className="w-full"
                  onClick={() => void checkout.refetch()}
                >
                  {t("retry")}
                </Button>
              </>
            )
          )}
        </div>
      ) : (
        <CheckoutExperience
          payment={payment}
          factors={{
            transferPassword: security.data?.transferPassword.enabled ?? false,
            twoFactor: security.data?.twoFactor.enabled ?? false,
            pending: security.isPending,
            error: security.error ? messageForError(security.error) : "",
          }}
          busy={busy}
          error={error}
          subscriptionCanceled={subscriptionCanceled}
          onConfirm={confirm}
          onCancelRenewals={cancelSubscription}
        />
      )}
    </CheckoutShell>
  );
}
