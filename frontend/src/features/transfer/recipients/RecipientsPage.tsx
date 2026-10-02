import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  ArrowUpRight01Icon,
  Clock01Icon,
  Delete02Icon,
  FavouriteIcon,
} from "@hugeicons/core-free-icons";
import { Button } from "@/shared/ui/button";
import { Icon, PageHeader } from "@/shared/ui/page";
import { useWallet } from "@/shared/hooks";
import {
  loadAddressBook,
  prefillTransfer,
  removeAddress,
  saveAddress,
  type SavedAddress,
} from "@/shared/lib/wallet";
import { dateText } from "@/shared/lib/wallet";

/** The Recipients page: saved shortcuts plus everyone this wallet paid. */
export function RecipientsPage() {
  const { transactions, userId } = useWallet();
  const [saved, setSaved] = useState<SavedAddress[]>(() => loadAddressBook(userId));
  const savedKeys = useMemo(
    () => new Set(saved.map((entry) => entry.address.toLowerCase())),
    [saved],
  );
  const recent = useMemo(() => {
    const seen = new Set<string>();
    const out: { address: string; at: string }[] = [];
    for (const tx of transactions) {
      if (tx.direction !== "sent") continue;
      const key = tx.counterpartyAddress.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ address: tx.counterpartyAddress, at: tx.createdAt });
      if (out.length >= 10) break;
    }
    return out;
  }, [transactions]);

  return (
    <>
      <PageHeader
        title="Recipients"
        subtitle="Everyone this wallet paid, plus the saved shortcut into the transfer form."
      />
      {saved.length > 0 && (
        <section className="rounded-[22px] border bg-card p-5 shadow-sm">
          <div className="flex items-center gap-2">
            <Icon icon={FavouriteIcon} size={19} className="text-primary-soft" />
            <h2 className="font-display font-semibold">Saved</h2>
          </div>
          <div className="mt-4">
            {saved.map((entry) => (
              <div
                key={entry.address}
                className="flex flex-wrap items-center gap-3 border-b px-1 py-3 last:border-0"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{entry.label}</p>
                  <code className="break-all text-xs text-muted-foreground">{entry.address}</code>
                </div>
                <Link to="/transfer" onClick={() => prefillTransfer(entry.address)}>
                  <Button className="rounded-full">
                    <Icon icon={ArrowUpRight01Icon} size={15} />
                    Send
                  </Button>
                </Link>
                <Button
                  variant="ghost"
                  size="icon"
                  title="Remove address"
                  aria-label={`Remove ${entry.label}`}
                  onClick={() => setSaved(removeAddress(userId, entry.address))}
                >
                  <Icon icon={Delete02Icon} size={17} />
                </Button>
              </div>
            ))}
          </div>
        </section>
      )}
      <section className="mt-4 rounded-[22px] border bg-card p-5 shadow-sm">
        <div className="flex items-center gap-2">
          <Icon icon={Clock01Icon} size={19} />
          <h2 className="font-display font-semibold">Recent</h2>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          Paid before, unsaved. Save one to give it a name and a shortcut chip.
        </p>
        <div className="mt-4">
          {recent.length ? (
            recent.map((item) => {
              const isSaved = savedKeys.has(item.address.toLowerCase());
              return (
                <div
                  key={item.address}
                  className="flex flex-wrap items-center gap-3 border-b px-1 py-3 last:border-0"
                >
                  <div className="min-w-0 flex-1">
                    <code className="break-all text-sm font-semibold">{item.address}</code>
                    <p className="text-xs text-muted-foreground">
                      Last paid {dateText(item.at)}
                      {isSaved ? " · saved" : ""}
                    </p>
                  </div>
                  {!isSaved && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="rounded-full"
                      onClick={() => {
                        setSaved(saveAddress(userId, item.address, ""));
                      }}
                    >
                      <Icon icon={FavouriteIcon} size={15} />
                      Save
                    </Button>
                  )}
                  <Link to="/transfer" onClick={() => prefillTransfer(item.address)}>
                    <Button variant="outline" size="sm" className="rounded-full">
                      <Icon icon={ArrowUpRight01Icon} size={15} />
                      Send
                    </Button>
                  </Link>
                </div>
              );
            })
          ) : (
            <p className="rounded-xl bg-secondary/60 px-4 py-3 text-xs text-muted-foreground">
              No outgoing transfers yet. Paid addresses will appear here for one-tap resending.
            </p>
          )}
        </div>
      </section>
    </>
  );
}
