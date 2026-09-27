import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  Mail01Icon,
  Settings01Icon,
  Shield01Icon,
  TransactionHistoryIcon,
  Wallet01Icon,
} from "@hugeicons/core-free-icons";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { LIMITS, sanitizeText } from "@/lib/validation";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useWallet } from "@/hooks/wallet-context";
import { api, messageForError, type ApiUser } from "@/lib/api";
import { countryName, geoCountries, securityScore } from "@/lib/security-state";
import { profileInitials } from "@/lib/profile-state";
import { currency, dateText } from "@/lib/wallet-format";
import { CopyButton, Icon, PageHeader } from "./wallet-shell";
import { FactList, FormMessage, Panel } from "./security-ui";

/**
 * The account behind the wallet: who owns it and what the wallet has done so far. Security and
 * Settings stay one click away from here because those sections are reached from the account menu
 * rather than from the rail.
 */
export function ProfileContent() {
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
      setMessage("Profile saved.");
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
        title="Profile"
        subtitle="Your account details and the wallet activity behind them."
        action={
          <Link to="/settings">
            <Button variant="outline">
              <Icon icon={Settings01Icon} size={17} />
              Account settings
            </Button>
          </Link>
        }
      />
      <div className="space-y-4">
        <Panel title="Identity" description="How your account is shown inside the wallet.">
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
              Display name
              <Input
                className="mt-2"
                required
                maxLength={LIMITS.maxDisplayNameLength}
                value={draft.displayName}
                onChange={(event) => setDraft({ ...draft, displayName: event.target.value })}
              />
            </label>
            <label className="block text-sm font-semibold">
              Country
              <Select
                value={draft.country ?? ""}
                onValueChange={(country) => setDraft({ ...draft, country })}
              >
                <SelectTrigger className="mt-2" aria-label="Country">
                  <SelectValue placeholder="Select a country" />
                </SelectTrigger>
                <SelectContent>
                  {geoCountries.map((country) => (
                    <SelectItem key={country.code} value={country.code}>
                      {country.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
            <div className="sm:col-span-2">
              <Button type="submit" disabled={busy}>
                {busy ? "Saving…" : "Save profile"}
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
          <Panel title="Wallet at a glance" description="Figures taken from the wallet itself.">
            <FactList
              items={[
                [
                  "Available balance",
                  <span key="balance" className="inline-flex items-center gap-2">
                    <Icon icon={Wallet01Icon} size={16} className="text-muted-foreground" />
                    {currency(wallet?.balance ?? "0")}
                  </span>,
                ],
                [
                  "Transfers recorded",
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
                  "Protections on",
                  `${score.enabledCount} of ${score.total} · score ${score.score}/${score.max}`,
                ],
                ["Wallet status", wallet?.status === "frozen" ? "Frozen" : "Active"],
              ]}
            />
          </Panel>
          <Panel title="Account" description="Identifiers you may need when contacting support.">
            <FactList
              items={[
                ["Account ID", <code key="id">{user?.id ?? "—"}</code>],
                [
                  "Wallet address",
                  <span key="address" className="flex items-center gap-1">
                    <code className="min-w-0 break-all">{wallet?.address ?? "—"}</code>
                    {wallet?.address && <CopyButton text={wallet.address} />}
                  </span>,
                ],
                [
                  "Sign-in email",
                  <span key="email" className="inline-flex items-center gap-2">
                    <Icon icon={Mail01Icon} size={16} className="text-muted-foreground" />
                    {user?.email ?? "—"}
                  </span>,
                ],
                ["Member since", user?.createdAt ? dateText(user.createdAt) : "—"],
              ]}
            />
          </Panel>
        </div>
        <Panel
          title="Protection and preferences"
          description="The two sections also live in the account menu, next to this page."
          bodyClassName="p-0"
        >
          <div className="grid sm:grid-cols-2">
            <Link
              to="/security"
              className="flex items-center gap-3 border-b px-5 py-4 transition-colors hover:bg-secondary/50 sm:border-b-0 sm:border-e"
            >
              <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-secondary text-muted-foreground">
                <Icon icon={Shield01Icon} size={19} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold">Security Center</span>
                <span className="mt-0.5 block text-xs text-muted-foreground">
                  {score.enabledCount} of {score.total} protections on · score {score.score}/
                  {score.max}
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
                <span className="block text-sm font-semibold">Settings</span>
                <span className="mt-0.5 block text-xs text-muted-foreground">
                  Account and wallet identity
                </span>
              </span>
            </Link>
          </div>
        </Panel>
      </div>
    </>
  );
}
