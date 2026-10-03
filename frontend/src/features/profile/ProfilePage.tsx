import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  Mail01Icon,
  Settings01Icon,
  Shield01Icon,
  TransactionHistoryIcon,
  Wallet01Icon,
} from "@hugeicons/core-free-icons";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { LIMITS, sanitizeText } from "@/shared/lib/platform";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/shared/ui/select";
import { useWallet } from "@/shared/hooks";
import { api, messageForError, type ApiUser } from "@/shared/api";
import { countryName, geoCountries, securityScore } from "@/shared/lib/security";
import { useT } from "@/shared/i18n";
import { profileInitials } from "@/shared/lib/account";
import { currency, dateText } from "@/shared/lib/wallet";
import { CopyButton, Icon, PageHeader } from "@/shared/ui/page";
import { FactList, FormMessage, Panel } from "@/shared/ui/panels";

/**
 * The account behind the wallet: who owns it and what the wallet has done so far. Security and
 * Settings stay one click away from here because those sections are reached from the account menu
 * rather than from the rail.
 */
export function ProfileContent() {
  const t = useT("profile");
  const common = useT("common");
  const { user, wallet, transactions, security, refresh, refreshSecurity } = useWallet();
  const [draft, setDraft] = useState<{ displayName: string; country: string | null }>({
    displayName: "",
    country: null,
  });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  /** The form starts empty and follows the loaded account, so a slow response never blocks it. */
  useEffect(() => {
    if (!user) return;
    setDraft((current) =>
      current.displayName ? current : { displayName: user.displayName, country: user.country },
    );
  }, [user]);
  const score = securityScore(security);
  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    setError("");
    try {
      await api.patch<{ user: ApiUser }>("/api/v1/me", {
        displayName: sanitizeText(draft.displayName, LIMITS.maxDisplayNameLength),
        country: draft.country,
      });
      setMessage(t("identity.saved"));
      await Promise.all([refresh(), refreshSecurity()]);
    } catch (cause) {
      setError(messageForError(cause));
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <PageHeader
        title={t("title")}
        subtitle={t("description")}
        action={
          <Link to="/settings">
            <Button variant="outline">
              <Icon icon={Settings01Icon} size={17} />
              {t("accountSettings")}
            </Button>
          </Link>
        }
      />
      <div className="space-y-4">
        <Panel title={t("identity.title")} description={t("identity.description")}>
          <div className="flex flex-wrap items-center gap-4">
            <span
              aria-hidden
              className="grid size-16 shrink-0 place-items-center rounded-2xl bg-primary font-display text-xl font-bold text-primary-foreground"
            >
              {profileInitials(user)}
            </span>
            <div className="min-w-0">
              <p className="font-display text-lg font-semibold">{user?.displayName ?? "—"}</p>
              <p className="text-sm text-muted-foreground">
                {user?.email ?? "—"} · {countryName(user?.country ?? null)}
              </p>
            </div>
          </div>
          <form
            className="mt-5 grid max-w-xl gap-4 sm:grid-cols-2"
            onSubmit={(event) => void save(event)}
          >
            <label className="block text-sm font-semibold">
              {t("identity.displayName")}
              <Input
                className="mt-2"
                required
                maxLength={LIMITS.maxDisplayNameLength}
                value={draft.displayName}
                onChange={(event) => setDraft({ ...draft, displayName: event.target.value })}
              />
            </label>
            <label className="block text-sm font-semibold">
              {t("identity.country")}
              <Select
                value={draft.country ?? ""}
                onValueChange={(country) => setDraft({ ...draft, country })}
              >
                <SelectTrigger className="mt-2" aria-label={t("identity.country")}>
                  <SelectValue placeholder={t("identity.selectCountry")} />
                </SelectTrigger>
                <SelectContent>
                  {geoCountries.map((code) => (
                    <SelectItem key={code} value={code}>
                      {countryName(code)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
            <div className="sm:col-span-2">
              <Button type="submit" disabled={busy}>
                {busy ? common("actions.saving") : t("identity.save")}
              </Button>
            </div>
          </form>
          {error && (
            <div className="mt-4">
              <FormMessage tone="error">{error}</FormMessage>
            </div>
          )}
          {message && (
            <div className="mt-4">
              <FormMessage tone="ok">{message}</FormMessage>
            </div>
          )}
        </Panel>
        <div className="grid gap-4 xl:grid-cols-[1.2fr_1fr]">
          <Panel title={t("glance.title")} description={t("glance.description")}>
            <FactList
              items={[
                [
                  t("glance.balance"),
                  <span key="balance" className="inline-flex items-center gap-2">
                    <Icon icon={Wallet01Icon} size={16} className="text-muted-foreground" />
                    {currency(wallet?.balance ?? "0")}
                  </span>,
                ],
                [
                  t("glance.transfers"),
                  <span key="transfers" className="inline-flex items-center gap-2">
                    <Icon
                      icon={TransactionHistoryIcon}
                      size={16}
                      className="text-muted-foreground"
                    />
                    {transactions.length}
                  </span>,
                ],
                [
                  t("glance.protections"),
                  t("glance.protectionsValue", {
                    enabled: score.enabledCount,
                    total: score.total,
                    score: score.score,
                    max: score.max,
                  }),
                ],
                [
                  t("glance.status"),
                  wallet?.status === "frozen" ? common("state.frozen") : common("state.active"),
                ],
              ]}
            />
          </Panel>
          <Panel title={t("account.title")} description={t("account.description")}>
            <FactList
              items={[
                [t("account.id"), <code key="id">{user?.id ?? common("state.none")}</code>],
                [
                  t("account.address"),
                  <span key="address" className="flex items-center gap-1">
                    <code className="min-w-0 break-all">{wallet?.address ?? "—"}</code>
                    {wallet?.address && <CopyButton text={wallet.address} />}
                  </span>,
                ],
                [
                  t("account.email"),
                  <span key="email" className="inline-flex items-center gap-2">
                    <Icon icon={Mail01Icon} size={16} className="text-muted-foreground" />
                    {user?.email ?? common("state.none")}
                  </span>,
                ],
                [
                  t("account.memberSince"),
                  user?.createdAt ? dateText(user.createdAt) : common("state.none"),
                ],
              ]}
            />
          </Panel>
        </div>
        <Panel title={t("links.title")} description={t("links.description")} bodyClassName="p-0">
          <div className="grid sm:grid-cols-2">
            <Link
              to="/security"
              className="flex items-center gap-3 border-b px-5 py-4 transition-colors hover:bg-secondary/50 sm:border-b-0 sm:border-e"
            >
              <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-secondary text-muted-foreground">
                <Icon icon={Shield01Icon} size={19} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold">{t("links.security")}</span>
                <span className="mt-0.5 block text-xs text-muted-foreground">
                  {t("links.securityDetail", {
                    enabled: score.enabledCount,
                    total: score.total,
                    score: score.score,
                    max: score.max,
                  })}
                </span>
              </span>
            </Link>
            <Link
              to="/settings"
              className="flex items-center gap-3 border-b px-5 py-4 transition-colors hover:bg-secondary/50 sm:border-b-0 sm:border-e"
            >
              <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-secondary text-muted-foreground">
                <Icon icon={Settings01Icon} size={19} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold">{t("links.settings")}</span>
                <span className="mt-0.5 block text-xs text-muted-foreground">
                  {t("links.settingsDetail")}
                </span>
              </span>
            </Link>
          </div>
        </Panel>
      </div>
    </>
  );
}
