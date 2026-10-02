import { useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  ArrowUpRight01Icon,
  BookBookmark01Icon,
  Clock01Icon,
  Delete02Icon,
  FavouriteIcon,
  PlusSignIcon,
} from "@hugeicons/core-free-icons";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Icon, PageHeader } from "@/shared/ui/page";
import { useWallet } from "@/shared/hooks";
import { LIMITS, isTransferTarget, sanitizeText } from "@/shared/lib/platform";
import {
  loadAddressBook,
  prefillTransfer,
  removeAddress,
  saveAddress,
  type SavedAddress,
} from "@/shared/lib/wallet";

/** The Address Book page: device-local saved addresses for one-tap paying. */
export function AddressBookPage() {
  const { wallet, userId } = useWallet();
  const [saved, setSaved] = useState<SavedAddress[]>(() => loadAddressBook(userId));
  const [newAddress, setNewAddress] = useState("");
  const [newLabel, setNewLabel] = useState("");
  const [bookError, setBookError] = useState("");

  const addSavedAddress = () => {
    setBookError("");
    const target = newAddress.trim();
    if (!isTransferTarget(target)) {
      setBookError("Enter a Louma wallet address (LMA-XXXX-XXXX-XXXX) or a @handle.");
      return;
    }
    if (target.toLowerCase() === wallet?.address.toLowerCase()) {
      setBookError("This is your own address. Save addresses you pay instead.");
      return;
    }
    setSaved(saveAddress(userId, target, sanitizeText(newLabel, LIMITS.maxDisplayNameLength)));
    setNewAddress("");
    setNewLabel("");
  };

  return (
    <>
      <PageHeader
        title="Address Book"
        subtitle="Addresses you pay often, one tap away in the transfer form."
        action={
          <Link to="/transfer/recipients">
            <Button variant="outline">
              <Icon icon={Clock01Icon} size={17} />
              Recent recipients
            </Button>
          </Link>
        }
      />
      <section className="rounded-[22px] border bg-card p-5 shadow-sm">
        <div className="flex items-center gap-2">
          <Icon icon={BookBookmark01Icon} size={19} />
          <h2 className="font-display font-semibold">Saved addresses</h2>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          Saved on this device only. A transfer cannot be reversed, so never retyping an address is
          the safety feature.
        </p>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            addSavedAddress();
          }}
          className="mt-4 grid gap-3 sm:grid-cols-[1fr_1fr_auto]"
        >
          <Input
            aria-label="Address to save"
            placeholder="LMA-XXXX-XXXX-XXXX or @handle"
            autoComplete="off"
            spellCheck={false}
            maxLength={LIMITS.maxRecipientLength}
            value={newAddress}
            onChange={(event) => {
              setNewAddress(event.target.value);
              setBookError("");
            }}
          />
          <Input
            aria-label="Label"
            placeholder="Label (e.g. Rent)"
            autoComplete="off"
            maxLength={LIMITS.maxDisplayNameLength}
            value={newLabel}
            onChange={(event) => {
              setNewLabel(event.target.value);
              setBookError("");
            }}
          />
          <Button type="submit" disabled={!newAddress.trim()}>
            <Icon icon={PlusSignIcon} size={16} />
            Save
          </Button>
        </form>
        {bookError && <p className="mt-3 text-xs text-destructive">{bookError}</p>}
        <div className="mt-4">
          {saved.length ? (
            saved.map((entry) => (
              <div
                key={entry.address}
                className="flex flex-wrap items-center gap-3 border-b px-1 py-3 last:border-0"
              >
                <Icon icon={FavouriteIcon} size={17} className="shrink-0 text-primary-soft" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{entry.label}</p>
                  <code className="break-all text-xs text-muted-foreground">{entry.address}</code>
                </div>
                <Link to="/transfer" onClick={() => prefillTransfer(entry.address)}>
                  <Button variant="outline" size="sm" className="rounded-full">
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
            ))
          ) : (
            <p className="rounded-xl bg-secondary/60 px-4 py-3 text-xs text-muted-foreground">
              No saved addresses yet. Save the ones you pay often — or save any verified recipient
              straight from the transfer form.
            </p>
          )}
        </div>
      </section>
    </>
  );
}
