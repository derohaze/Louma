import { useEffect, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { CopyButton, PageHeader } from "@/shared/ui/page";
import { FormMessage } from "@/shared/ui/panels";
import { useProAccess, useWallet } from "@/shared/hooks";
import {
  api,
  ApiError,
  messageForError,
  type ApiCustomAddressState,
  type ApiSubscription,
} from "@/shared/api";
import { isCustomAddress } from "@/shared/lib/platform";
import { currentLocale, useT } from "@/shared/i18n";

export function CustomAddressPage({ state }: { state: ApiCustomAddressState }) {
  const t = useT("wallet.customAddress");
  const common = useT("common");
  const { wallet, refresh } = useWallet();
  const [subscription, setSubscription] = useState(state.subscription);
  const pro = useProAccess(subscription);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [name, setName] = useState("");
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [updated, setUpdated] = useState(false);
  const [error, setError] = useState("");
  const date = (value: string | Date) =>
    new Intl.DateTimeFormat(currentLocale(), { dateStyle: "medium" }).format(new Date(value));
  const next = wallet?.customAddressChangedAt
    ? new Date(Date.parse(wallet.customAddressChangedAt) + 30 * 86400000)
    : null;
  const waiting = next !== null && next.getTime() > Date.now();
  const receivingAddress = wallet?.customAddress ?? wallet?.address;
  const invalid = touched && !isCustomAddress(name);
  useEffect(() => {
    setSubscription(state.subscription);
  }, [state.subscription]);
  useEffect(() => {
    if (pro) return;
    let mounted = true;
    // An operator may have renewed Pro while this page was open. Verify before redirecting.
    void api
      .get<{ subscription: ApiSubscription }>("/api/v1/subscription")
      .then((result) => {
        if (!mounted) return;
        setSubscription(result.subscription);
        void refresh();
        if (result.subscription.tier !== "pro") void navigate({ to: "/wallet", replace: true });
      })
      .catch((cause: unknown) => {
        if (mounted) setError(messageForError(cause));
      });
    return () => {
      mounted = false;
    };
  }, [pro, navigate, refresh]);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy || waiting || !pro) return;
    setTouched(true);
    if (!isCustomAddress(name)) {
      input.current?.focus();
      return;
    }
    setBusy(true);
    setUpdated(false);
    setError("");
    try {
      await api.patch("/api/v1/wallet/custom-address", { address: name.toLowerCase() });
      setUpdated(true);
      setName("");
      setTouched(false);
      await refresh();
      await queryClient.invalidateQueries({ queryKey: ["account", "custom-address"] });
    } catch (cause) {
      setError(
        cause instanceof ApiError && cause.code === "pro_required"
          ? t("proRequired")
          : messageForError(cause),
      );
      if (cause instanceof ApiError && cause.code === "pro_required") {
        await refresh();
        await navigate({ to: "/wallet", replace: true });
      }
    } finally {
      setBusy(false);
    }
  };
  if (!pro) return error ? <FormMessage tone="error">{error}</FormMessage> : null;
  return (
    <>
      <PageHeader title={t("title")} subtitle={t("description")} />
      <section className="card-enter max-w-2xl rounded-[22px] border bg-card p-5 shadow-sm">
        <div className="mb-5 flex flex-wrap items-center gap-2">
          <span className="rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">
            {t(subscription.plan ?? "monthly")}
          </span>
          {subscription.expiresAt && (
            <span className="text-sm text-muted-foreground">
              {t("expires", { date: date(subscription.expiresAt) })}
            </span>
          )}
        </div>
        <p className="text-sm text-muted-foreground">{t("current")}</p>
        <div className="mt-2 flex items-center gap-2 rounded-xl bg-secondary p-3">
          <code dir="ltr" className="min-w-0 flex-1 break-all">
            {receivingAddress}
          </code>
          {receivingAddress && <CopyButton text={receivingAddress} />}
        </div>
        <p className="mt-5 text-sm">{t("cadence")}</p>
        <form noValidate onSubmit={(event) => void submit(event)} className="mt-5 space-y-3">
          <label htmlFor="custom-address" className="block text-sm font-semibold">
            {t("newAddress")}
          </label>
          <Input
            ref={input}
            id="custom-address"
            dir="ltr"
            required
            minLength={3}
            maxLength={16}
            pattern="[A-Za-z][A-Za-z0-9]{2,15}"
            autoCapitalize="none"
            autoComplete="off"
            spellCheck={false}
            className="min-h-11"
            disabled={busy || waiting}
            value={name}
            onChange={(event) => {
              setName(event.target.value);
              setError("");
            }}
            onBlur={() => setTouched(true)}
            placeholder={t("placeholder")}
            aria-invalid={invalid}
            aria-describedby="custom-address-rules"
          />
          <p
            id="custom-address-rules"
            role={invalid ? "alert" : undefined}
            className={`text-xs leading-5 ${invalid ? "text-destructive" : "text-muted-foreground"}`}
          >
            {t("rules")}
          </p>
          {waiting && next && (
            <p className="rounded-xl border bg-secondary p-3 text-sm">
              {t("nextChange", { date: date(next) })}
            </p>
          )}
          <Button className="min-h-11" disabled={busy || waiting}>
            {busy ? common("actions.saving") : t("save")}
          </Button>
          {error && <FormMessage tone="error">{error}</FormMessage>}
          {updated && <FormMessage tone="ok">{t("updated")}</FormMessage>}
        </form>
        <div className="mt-6 border-t pt-5">
          <p className="text-sm font-semibold">{t("canonical")}</p>
          <div className="mt-2 flex items-center gap-2">
            <code dir="ltr" className="min-w-0 flex-1 break-all text-xs">
              {wallet?.address}
            </code>
            {wallet?.address && <CopyButton text={wallet.address} />}
          </div>
          <p className="mt-2 text-xs leading-5 text-muted-foreground">{t("fallback")}</p>
        </div>
        <div className="mt-6 border-t pt-5">
          <h2 className="font-semibold">{t("history")}</h2>
          <p className="mt-1 text-xs text-muted-foreground">{t("historyDescription")}</p>
          {state.history.length === 0 ? (
            <p className="mt-3 text-sm text-muted-foreground">{t("noHistory")}</p>
          ) : (
            <ul className="mt-3 divide-y">
              {state.history.map((row) => (
                <li key={row.id} className="py-3">
                  <div dir="ltr" className="flex flex-wrap items-center gap-2 text-sm">
                    <code className="break-all">{row.previousAddress}</code>
                    <span aria-hidden>→</span>
                    <code className="break-all">{row.nextAddress}</code>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {t(row.reason)} · {date(row.createdAt)}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </>
  );
}
