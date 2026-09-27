import { useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  Clock01Icon,
  CrownIcon,
  EyeOffIcon,
  FirewallIcon,
  GlobeLockIcon,
} from "@hugeicons/core-free-icons";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useWallet } from "@/hooks/use-wallet";
import {
  readSettings,
  settingsPage,
  updateSettings,
  type WalletSettings,
} from "@/lib/demo-settings";
import { updateDemoWallet } from "@/lib/demo-wallet";
import { dateText } from "@/lib/wallet-format";
import { CopyButton, Icon, PageHeader } from "./wallet-shell";
import { FactList, FormMessage, Panel, PreviewNote } from "./security-ui";

/** Label, hint, and switch — the row shape every preference on these pages shares. */
function SettingRow({
  title,
  hint,
  checked,
  onChange,
  label,
}: {
  title: string;
  hint: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
}) {
  return (
    <label className="flex items-start justify-between gap-4 border-b py-4 last:border-0">
      <span className="min-w-0">
        <span className="block text-sm font-semibold">{title}</span>
        <span className="mt-1 block text-xs text-muted-foreground">{hint}</span>
      </span>
      <Switch checked={checked} onCheckedChange={onChange} aria-label={label} />
    </label>
  );
}

/** Shortcuts into the controls that depend on a known location or address. */
const accessControls = [
  { title: "Geo-Lock", href: "/security/geo-lock", icon: GlobeLockIcon },
  { title: "IP Whitelist", href: "/security/ip-whitelist", icon: FirewallIcon },
  { title: "Time-based Access", href: "/security/time-access", icon: Clock01Icon },
] as const;

export function AccountContent() {
  const page = settingsPage("/settings");
  const { wallet, email, userId, transactions, refresh } = useWallet();
  const [message, setMessage] = useState("");
  return (
    <>
      <PageHeader title={page.title} subtitle={page.description} />
      <div className="space-y-4">
        <Panel title="Wallet identity" description="Details tied to this wallet account.">
          <FactList
            items={[
              ["Sign-in email", email ?? "—"],
              [
                "Account ID",
                <code key="id" className="break-all">
                  {userId ?? "—"}
                </code>,
              ],
              [
                "Wallet address",
                <span key="address" className="flex items-center gap-1">
                  <code className="min-w-0 break-all">{wallet?.address ?? "—"}</code>
                  {wallet?.address && <CopyButton text={wallet.address} />}
                </span>,
              ],
              ["Created", wallet?.created_at ? dateText(wallet.created_at) : "—"],
            ]}
          />
        </Panel>
        <Panel title="Access controls" description="Every protection is available on this wallet.">
          <p className="text-sm text-muted-foreground">
            The controls that depend on a known location or address live next to the other
            protections in the Security section.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            {accessControls.map((control) => (
              <Link
                key={control.href}
                to={control.href}
                className="inline-flex items-center gap-2 rounded-full border bg-secondary/60 px-3 py-1.5 text-xs font-semibold transition-colors hover:bg-card"
              >
                <Icon icon={control.icon} size={15} />
                {control.title}
              </Link>
            ))}
          </div>
          <p className="mt-4 text-xs text-muted-foreground">
            {transactions.length} transfers recorded on this wallet.
          </p>
        </Panel>
        <Panel
          title="Delete wallet account"
          description="Permanently removes the wallet, its balance, and its history."
          tone="danger"
          action={
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="outline" className="border-destructive text-destructive">
                  Delete account
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete this wallet account?</AlertDialogTitle>
                  <AlertDialogDescription>
                    The wallet, its address, and every transfer would be removed permanently. This
                    cannot be undone.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Keep my wallet</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={() =>
                      setMessage(
                        "Account deletion is disabled in this preview. Nothing was deleted.",
                      )
                    }
                  >
                    Delete account
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          }
        >
          <p className="text-sm text-muted-foreground">
            Withdraw your balance before deleting the account: anything left in the wallet cannot be
            recovered afterwards.
          </p>
          {message && (
            <div className="mt-4">
              <FormMessage tone="ok">{message}</FormMessage>
            </div>
          )}
        </Panel>
      </div>
    </>
  );
}

export function PrivacyContent() {
  const page = settingsPage("/settings/privacy");
  const { wallet, refresh } = useWallet();
  const [settings, setSettings] = useState(readSettings);
  const [message, setMessage] = useState("");
  const save = (changes: Partial<WalletSettings>) => {
    updateSettings(changes);
    setSettings(readSettings());
    setMessage("Settings saved.");
  };
  return (
    <>
      <PageHeader title={page.title} subtitle={page.description} />
      <div className="space-y-4">
        <Panel
          title="What this wallet shows"
          description="These choices apply to your account, not just this device."
        >
          <SettingRow
            title="Hide balance on this device"
            hint="Covers the balance figures on the overview and wallet pages."
            label="Hide balance"
            checked={wallet?.privacy_mode ?? false}
            onChange={(checked) => {
              updateDemoWallet({ privacy_mode: checked });
              setMessage("Settings saved.");
              void refresh();
            }}
          />
          <SettingRow
            title="Hide my wallet from the leaderboard"
            hint="Removes your row from the rankings. Your position stays reserved."
            label="Hide from leaderboard"
            checked={settings.hideRanking}
            onChange={(checked) => save({ hideRanking: checked })}
          />
          <SettingRow
            title="Email me security alerts"
            hint="Sends a message for new sign-ins and security changes."
            label="Email security alerts"
            checked={settings.emailSecurityAlerts}
            onChange={(checked) => save({ emailSecurityAlerts: checked })}
          />
          {message && (
            <div className="mt-4">
              <FormMessage tone="ok">{message}</FormMessage>
            </div>
          )}
        </Panel>
        <Panel
          title="Leaderboard visibility"
          description="Hiding your wallet keeps the ranking private."
          action={
            <Link to="/leaderboard">
              <Button variant="outline" size="sm">
                <Icon icon={EyeOffIcon} size={16} />
                View leaderboard
              </Button>
            </Link>
          }
        >
          <p className="text-sm text-muted-foreground">
            {settings.hideRanking
              ? "Your wallet is currently hidden from the public rankings."
              : "Your wallet is visible in the public rankings."}
          </p>
        </Panel>
        <PreviewNote>
          Preview build: preferences are kept for this session only and reset on reload.
        </PreviewNote>
      </div>
    </>
  );
}
