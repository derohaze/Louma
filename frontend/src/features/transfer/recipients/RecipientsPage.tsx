import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  ArrowUpRight01Icon,
  Clock01Icon,
  Delete02Icon,
  FavouriteIcon,
} from "@hugeicons/core-free-icons";
import { Button } from "@/shared/ui/button";
import { Icon, PageHeader, revealDelay } from "@/shared/ui/page";
import { Input } from "@/shared/ui/input";
import { useT } from "@/shared/i18n";
import { useWallet } from "@/shared/hooks";
import { LIMITS } from "@/shared/lib/platform";
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
  const t = useT("transfer.recipients");
  const { transactions, userId } = useWallet();
  const [saved, setSaved] = useState<SavedAddress[]>(() => loadAddressBook(userId));
  /** Unsaved label edits, keyed by address: renaming never writes until it is saved. */
  const [labelDrafts, setLabelDrafts] = useState<Record<string, string>>({});
  const setDraft = (address: string, label: string) =>
    setLabelDrafts((current) => ({ ...current, [address]: label }));
  const clearDraft = (address: string) =>
    setLabelDrafts((current) => {
      if (!(address in current)) return current;
      const next = { ...current };
      delete next[address];
      return next;
    });
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
      <PageHeader title={t("title")} subtitle={t("description")} />
      {saved.length > 0 && (
        <section
          style={revealDelay(0)}
          className="card-enter rounded-[22px] border bg-card p-5 shadow-sm"
        >
          <div className="flex items-center gap-2">
            <Icon icon={FavouriteIcon} size={19} className="text-primary-soft" />
            <h2 className="font-display font-semibold">{t("saved")}</h2>
          </div>
          <div className="mt-4">
            {saved.map((entry) => {
              const draft = labelDrafts[entry.address] ?? entry.label;
              const dirty = draft.trim() !== entry.label;
              return (
                <div
                  key={entry.address}
                  className="flex flex-wrap items-center gap-3 border-b px-1 py-3 last:border-0"
                >
                  <div className="min-w-0 flex-1">
                    <Input
                      value={draft}
                      onChange={(event) => setDraft(entry.address, event.target.value)}
                      maxLength={LIMITS.maxDisplayNameLength}
                      aria-label={t("labelAria", { address: entry.address })}
                      className="h-8 text-sm font-semibold"
                    />
                    <code className="mt-1 block break-all text-xs text-muted-foreground">
                      {entry.address}
                    </code>
                  </div>
                  <Link to="/transfer" onClick={() => prefillTransfer(entry.address)}>
                    <Button className="rounded-full">
                      <Icon icon={ArrowUpRight01Icon} size={15} />
                      {t("send")}
                    </Button>
                  </Link>
                  {dirty && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="rounded-full"
                      onClick={() => {
                        setSaved(saveAddress(userId, entry.address, draft));
                        clearDraft(entry.address);
                      }}
                    >
                      {t("saveLabel")}
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="icon"
                    title={t("remove")}
                    aria-label={t("removeAria", { label: entry.label })}
                    onClick={() => setSaved(removeAddress(userId, entry.address))}
                  >
                    <Icon icon={Delete02Icon} size={17} />
                  </Button>
                </div>
              );
            })}
          </div>
        </section>
      )}
      <section
        style={revealDelay(1)}
        className="card-enter mt-4 rounded-[22px] border bg-card p-5 shadow-sm"
      >
        <div className="flex items-center gap-2">
          <Icon icon={Clock01Icon} size={19} />
          <h2 className="font-display font-semibold">{t("recent")}</h2>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">{t("recentNote")}</p>
        <div className="mt-4">
          {recent.length ? (
            recent.map((item, row) => {
              const isSaved = savedKeys.has(item.address.toLowerCase());
              return (
                <div
                  key={item.address}
                  style={revealDelay(row, 45, 360)}
                  className="list-enter flex flex-wrap items-center gap-3 border-b px-1 py-3 last:border-0"
                >
                  <div className="min-w-0 flex-1">
                    <code className="break-all text-sm font-semibold">{item.address}</code>
                    <p className="text-xs text-muted-foreground">
                      {t("lastPaid", { date: dateText(item.at) })}
                      {isSaved ? t("savedTag") : ""}
                    </p>
                  </div>
                  {!isSaved && (
                    <>
                      <Input
                        value={labelDrafts[item.address] ?? ""}
                        onChange={(event) => setDraft(item.address, event.target.value)}
                        maxLength={LIMITS.maxDisplayNameLength}
                        placeholder={t("labelPlaceholder")}
                        aria-label={t("labelAria", { address: item.address })}
                        className="h-8 w-36 text-xs"
                      />
                      <Button
                        variant="ghost"
                        size="sm"
                        className="rounded-full"
                        onClick={() => {
                          setSaved(
                            saveAddress(userId, item.address, labelDrafts[item.address] ?? ""),
                          );
                          clearDraft(item.address);
                        }}
                      >
                        <Icon icon={FavouriteIcon} size={15} />
                        {t("saveLabel")}
                      </Button>
                    </>
                  )}
                  <Link to="/transfer" onClick={() => prefillTransfer(item.address)}>
                    <Button variant="outline" size="sm" className="rounded-full">
                      <Icon icon={ArrowUpRight01Icon} size={15} />
                      {t("send")}
                    </Button>
                  </Link>
                </div>
              );
            })
          ) : (
            <p className="rounded-xl bg-secondary/60 px-4 py-3 text-xs text-muted-foreground">
              {t("empty")}
            </p>
          )}
        </div>
      </section>
    </>
  );
}
