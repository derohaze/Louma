import { useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  CpuIcon,
  Mail01Icon,
  RankingIcon,
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
import { useWallet } from "@/hooks/use-wallet";
import { rankLeaderboard, readLeaderboard } from "@/lib/demo-leaderboard";
import { readMining } from "@/lib/demo-mining";
import { countryName, geoCountries, readSecurity, securityScore } from "@/lib/demo-security";
import {
  profileAccountId,
  profileInitials,
  readProfile,
  updateProfile,
  type Profile,
} from "@/lib/demo-profile";
import { currency, dateText } from "@/lib/wallet-format";
import { CopyButton, Icon, PageHeader } from "./wallet-shell";
import { FactList, FormMessage, Panel, PreviewNote } from "./security-ui";

/**
 * The account behind the wallet: who owns it and what the wallet has done so far. Security and
 * Settings stay one click away from here because those sections are reached from the account menu
 * rather than from the rail.
 */
export function ProfileContent() {
  const { wallet, email, transactions } = useWallet();
  const [saved, setSaved] = useState<Profile>(readProfile);
  const [draft, setDraft] = useState<Profile>(readProfile);
  const [message, setMessage] = useState("");
  const security = securityScore(readSecurity());
  const rank = rankLeaderboard(readLeaderboard(), "balance").find((entry) => entry.isYou)?.rank;
  const miningEarned = readMining().lifetimeEarnings;
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
              {profileInitials(saved)}
            </span>
            <div className="min-w-0">
              <p className="font-display text-lg font-semibold">{saved.displayName}</p>
              <p className="text-sm text-muted-foreground">
                {email ?? "—"} · {countryName(saved.country)}
              </p>
            </div>
          </div>
          <form
            className="mt-5 grid max-w-xl gap-4 sm:grid-cols-2"
            onSubmit={(event) => {
              event.preventDefault();
              updateProfile({
                displayName: sanitizeText(draft.displayName, LIMITS.maxDisplayNameLength),
                country: draft.country,
              });
              setSaved(readProfile());
              setMessage("Profile saved.");
            }}
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
                value={draft.country}
                onValueChange={(country) => setDraft({ ...draft, country })}
              >
                <SelectTrigger className="mt-2" aria-label="Country">
                  <SelectValue />
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
              <Button type="submit">Save profile</Button>
            </div>
          </form>
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
                    {currency(wallet?.balance ?? 0)}
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
                  "Mining earned",
                  <span key="mining" className="inline-flex items-center gap-2">
                    <Icon icon={CpuIcon} size={16} className="text-muted-foreground" />
                    {currency(miningEarned)}
                  </span>,
                ],
                [
                  "Leaderboard place",
                  <span key="rank" className="inline-flex items-center gap-2">
                    <Icon icon={RankingIcon} size={16} className="text-muted-foreground" />
                    {rank ? `#${rank}` : "—"}
                  </span>,
                ],
              ]}
            />
          </Panel>
          <Panel title="Account" description="Identifiers you may need when contacting support.">
            <FactList
              items={[
                ["Account ID", <code key="id">{profileAccountId()}</code>],
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
                    {email ?? "—"}
                  </span>,
                ],
                ["Member since", wallet?.created_at ? dateText(wallet.created_at) : "—"],
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
                  {security.enabledCount} of {security.total} protections on · score{" "}
                  {security.score}/{security.max}
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
        <PreviewNote>
          Preview build: profile changes are kept for this session only, and the mining figure comes
          from the demo farm.
        </PreviewNote>
      </div>
    </>
  );
}
