import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  ArrowLeft01Icon,
  Comment01Icon,
  StarIcon,
  UserCircleIcon,
} from "@hugeicons/core-free-icons";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { countryName } from "@/lib/demo-security";
import {
  ownHandle,
  publicProfile,
  rateTransfer,
  ratingSummary,
  readGivenRatings,
  readRatingsSettings,
  readReceivedRatings,
  updateRatingsSettings,
  type PublicProfile,
  type RatingsSettings,
} from "@/lib/demo-ratings";
import { currency, dateText } from "@/lib/wallet-format";
import { EmptyState, Icon, PageHeader } from "./wallet-shell";
import { FactList, FormMessage, Panel, PreviewNote, StatusPill } from "./security-ui";

/** Five stars with the scored ones picked out, used wherever a rating is shown. */
export function StarRow({ stars, size = 16 }: { stars: number; size?: number }) {
  return (
    <span className="flex items-center gap-0.5" aria-label={`${stars} out of 5`}>
      {[1, 2, 3, 4, 5].map((position) => (
        <Icon
          key={position}
          icon={StarIcon}
          size={size}
          className={position <= stars ? "text-[#D98A00]" : "text-muted-foreground/40"}
        />
      ))}
    </span>
  );
}

/**
 * Rating a counterparty right after a transfer, from the transactions list, or from the transfer
 * itself. One dialog serves all three so the score and the note are written in a single place.
 */
export function RatingDialog({
  open,
  onOpenChange,
  target,
  transferId,
  initialStars = 0,
  initialNote = "",
  onRated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Address or handle the rating is for, as the transaction recorded it. */
  target: string;
  transferId: string;
  initialStars?: number;
  initialNote?: string;
  onRated?: () => void;
}) {
  const [stars, setStars] = useState(initialStars);
  const [note, setNote] = useState(initialNote);
  // Reopening starts from the rating that is already stored, not from the last attempt.
  useEffect(() => {
    if (open) {
      setStars(initialStars);
      setNote(initialNote);
    }
  }, [open, initialStars, initialNote]);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md rounded-[22px]">
        <DialogHeader>
          <DialogTitle className="font-display">Rate {target}</DialogTitle>
          <DialogDescription>
            Your score is added to {target}'s public profile. The note is optional and is only shown
            while that wallet publishes written feedback.
          </DialogDescription>
        </DialogHeader>
        <div className="flex items-center gap-2">
          {[1, 2, 3, 4, 5].map((value) => (
            <Button
              key={value}
              type="button"
              size="icon"
              variant={stars === value ? "default" : "outline"}
              aria-label={`Rate ${value} out of 5`}
              aria-pressed={stars === value}
              onClick={() => setStars(stars === value ? 0 : value)}
            >
              {value}
            </Button>
          ))}
        </div>
        <label className="block text-sm font-semibold">
          Note (optional)
          <Textarea
            className="mt-2"
            maxLength={200}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="How did this transfer go?"
          />
        </label>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Not now
          </Button>
          <Button
            disabled={stars === 0}
            onClick={() => {
              rateTransfer(transferId, stars, note);
              onRated?.();
              onOpenChange(false);
            }}
          >
            Save rating
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** One switchable row of the ratings settings. */
function SettingRow({
  label,
  detail,
  checked,
  onChange,
}: {
  label: string;
  detail: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <div className="flex items-center gap-4 border-b px-5 py-4 last:border-0">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold">{label}</p>
        <p className="mt-1 text-xs text-muted-foreground">{detail}</p>
      </div>
      <Switch checked={checked} onCheckedChange={onChange} aria-label={label} />
    </div>
  );
}

export function RatingsSettingsContent() {
  const [settings, setSettings] = useState(readRatingsSettings);
  const update = (changes: Partial<RatingsSettings>) => {
    updateRatingsSettings(changes);
    setSettings(readRatingsSettings());
  };
  const received = readReceivedRatings();
  const summary = ratingSummary(received);
  const given = readGivenRatings();
  return (
    <>
      <PageHeader
        title="Ratings"
        subtitle="Choose the ratings you accept and what your public profile publishes."
      />
      <div className="space-y-4">
        <section className="rounded-[22px] border bg-card shadow-sm">
          <div className="flex flex-wrap items-center gap-3 border-b px-5 py-4">
            <div className="min-w-0 flex-1">
              <h2 className="font-display font-semibold">Incoming ratings</h2>
              <p className="mt-1 text-xs text-muted-foreground">
                What other wallets may leave after a transfer with you.
              </p>
            </div>
            <StatusPill enabled={settings.allowIncoming} on="Accepted" off="Off" />
          </div>
          <SettingRow
            label="Accept ratings"
            detail="Wallets you transact with can score the transfer and leave a note."
            checked={settings.allowIncoming}
            onChange={(value) => update({ allowIncoming: value })}
          />
        </section>

        <section className="rounded-[22px] border bg-card shadow-sm">
          <div className="border-b px-5 py-4">
            <h2 className="font-display font-semibold">Public profile</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              What a visitor sees on @{ownHandle()}.
            </p>
          </div>
          <SettingRow
            label="Publish the average"
            detail="Show your average score and how many wallets rated you."
            checked={settings.showAverage}
            onChange={(value) => update({ showAverage: value })}
          />
          <SettingRow
            label="Publish written notes"
            detail="Show the notes other wallets wrote next to their score."
            checked={settings.showNotes}
            onChange={(value) => update({ showNotes: value })}
          />
          <SettingRow
            label="Publish activity"
            detail="Show your balance, transfer count, and mining total on the profile."
            checked={settings.showActivity}
            onChange={(value) => update({ showActivity: value })}
          />
        </section>

        <Panel title="Your score" description="Averaged from the ratings other wallets left.">
          {summary.average === null ? (
            <p className="text-sm text-muted-foreground">No ratings yet.</p>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-3">
                <strong className="font-display text-3xl font-bold">{summary.average}</strong>
                <StarRow stars={Math.round(summary.average)} size={18} />
                <span className="text-sm text-muted-foreground">
                  {summary.count} rating{summary.count === 1 ? "" : "s"}
                </span>
              </div>
              <div className="mt-5 space-y-2">
                {[5, 4, 3, 2, 1].map((stars, index) => {
                  const count = summary.distribution[index] ?? 0;
                  const width = summary.count ? Math.round((count / summary.count) * 100) : 0;
                  return (
                    <div key={stars} className="flex items-center gap-3 text-xs">
                      <span className="w-10 shrink-0 text-muted-foreground">{stars} star</span>
                      <span className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-secondary">
                        <span
                          className="block h-full rounded-full bg-[#D98A00]"
                          style={{ width: `${width}%` }}
                        />
                      </span>
                      <span className="w-6 shrink-0 text-end">{count}</span>
                    </div>
                  );
                })}
              </div>
            </>
          )}
          <div className="mt-5">
            <Link to="/profile/$username" params={{ username: ownHandle() }}>
              <Button variant="outline">
                <Icon icon={UserCircleIcon} size={17} />
                Preview public profile
              </Button>
            </Link>
          </div>
        </Panel>

        <Panel
          title="Ratings you received"
          description="Newest first. The note is what the other wallet wrote."
          bodyClassName="p-0"
        >
          {received.length ? (
            received.map((rating) => (
              <div
                key={rating.id}
                className="flex flex-wrap items-center gap-3 border-b px-5 py-4 last:border-0"
              >
                <StarRow stars={rating.stars} />
                <div className="min-w-0 flex-1">
                  <Link
                    to="/profile/$username"
                    params={{ username: rating.from }}
                    className="text-sm font-semibold transition-colors hover:text-primary"
                  >
                    @{rating.from}
                  </Link>
                  {rating.note && (
                    <p className="mt-1 text-xs text-muted-foreground">{rating.note}</p>
                  )}
                </div>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {dateText(rating.at)}
                </span>
              </div>
            ))
          ) : (
            <p className="px-5 py-6 text-sm text-muted-foreground">
              Incoming ratings are switched off, so nothing is collected.
            </p>
          )}
        </Panel>

        <Panel
          title="Ratings you gave"
          description="Left on your own transfers. You can change one at any time."
          bodyClassName="p-0"
        >
          {given.length ? (
            given.map((rating) => (
              <div
                key={rating.transferId}
                className="flex flex-wrap items-center gap-3 border-b px-5 py-4 last:border-0"
              >
                <Icon icon={Comment01Icon} size={19} className="shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{rating.to}</p>
                  <p className="text-xs text-muted-foreground">
                    {rating.note || "No note left"} · {dateText(rating.at)}
                  </p>
                </div>
                <StarRow stars={rating.stars} />
                <Link to="/history/$transferId" params={{ transferId: rating.transferId }}>
                  <Button variant="outline" size="sm">
                    Open
                  </Button>
                </Link>
              </div>
            ))
          ) : (
            <p className="px-5 py-6 text-sm text-muted-foreground">
              You have not rated a transfer yet.
            </p>
          )}
        </Panel>

        <PreviewNote>
          Preview build: ratings and these settings live in this session's memory. The public
          profile you see is the same page a visitor would open.
        </PreviewNote>
      </div>
    </>
  );
}

/** How a wallet presents itself to the wallets it trades with. */
export function PublicProfileContent({ username }: { username: string }) {
  /**
   * Links carry the handle with its "@" and the old wallet also linked bare handles, so the
   * segment is normalised once here instead of assuming either shape.
   */
  const target = username.trim();
  const profile: PublicProfile | null = publicProfile(target.replace(/^@/, ""));
  if (!profile) {
    return (
      <EmptyState
        title={`No profile for ${target.startsWith("@") ? target : `@${target}`}`}
        detail="This handle has no public profile. Handles are listed on the leaderboard."
        action={
          <Link to="/leaderboard">
            <Button variant="outline">
              <Icon icon={ArrowLeft01Icon} size={17} />
              Open the leaderboard
            </Button>
          </Link>
        }
      />
    );
  }
  const summary = ratingSummary(profile.ratings);
  const initials = profile.displayName
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join("");
  return (
    <>
      <section className="rounded-[22px] border bg-card p-5 shadow-sm">
        <div className="flex flex-wrap items-center gap-4">
          <span className="grid size-14 place-items-center rounded-2xl bg-secondary font-display text-lg font-bold">
            {initials || "?"}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="font-display text-xl font-semibold">{profile.displayName}</h1>
              {profile.own && <StatusPill enabled on="Your public view" />}
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              @{profile.handle} · {profile.headline}
            </p>
          </div>
          {profile.own && (
            <Link to="/profile/ratings">
              <Button variant="outline">Ratings settings</Button>
            </Link>
          )}
        </div>
        <div className="mt-5 grid gap-4 sm:grid-cols-3">
          {[
            ["Member since", new Date(profile.joinedAt).toLocaleDateString()],
            ["Country", countryName(profile.countryCode)],
            ["Rating", summary.average === null ? "No ratings" : `${summary.average} / 5`],
          ].map(([label, value]) => (
            <div key={label}>
              <p className="text-xs text-muted-foreground">{label}</p>
              <p className="mt-1 text-sm font-semibold">{value}</p>
            </div>
          ))}
        </div>
      </section>
      <div className="mt-4 grid gap-4 xl:grid-cols-[1.3fr_1fr]">
        <Panel
          title="Ratings"
          description="What the wallets it traded with said about it."
          bodyClassName="p-0"
        >
          {!profile.visibility.average ? (
            <p className="px-5 py-6 text-sm text-muted-foreground">
              This wallet keeps its rating private.
            </p>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-3 border-b px-5 py-4">
                <strong className="font-display text-3xl font-bold">
                  {summary.average ?? "—"}
                </strong>
                <StarRow stars={Math.round(summary.average ?? 0)} size={18} />
                <span className="text-sm text-muted-foreground">
                  {summary.count} rating{summary.count === 1 ? "" : "s"}
                </span>
              </div>
              {profile.ratings.map((rating) => (
                <div key={rating.id} className="border-b px-5 py-4 last:border-0">
                  <div className="flex flex-wrap items-center gap-3">
                    <StarRow stars={rating.stars} />
                    <Link
                      to="/profile/$username"
                      params={{ username: rating.from }}
                      className="text-sm font-semibold transition-colors hover:text-primary"
                    >
                      @{rating.from}
                    </Link>
                    <span className="ms-auto text-xs text-muted-foreground">
                      {dateText(rating.at)}
                    </span>
                  </div>
                  {profile.visibility.notes && rating.note && (
                    <p className="mt-2 text-sm text-muted-foreground">{rating.note}</p>
                  )}
                </div>
              ))}
            </>
          )}
        </Panel>
        <Panel title="Activity" description="The totals this wallet chose to publish.">
          {profile.visibility.activity ? (
            <FactList
              items={[
                ["Balance", currency(profile.balance)],
                ["Transfers", String(profile.transfers)],
                ["Mining earnings", currency(profile.miningEarnings)],
              ]}
            />
          ) : (
            <p className="text-sm text-muted-foreground">
              This wallet keeps its balance and activity private.
            </p>
          )}
          {profile.own && (
            <div className="mt-5">
              <FormMessage tone="ok">
                This is your own public view. Switch fields on or off on the Ratings page.
              </FormMessage>
            </div>
          )}
        </Panel>
      </div>
      <div className="mt-4">
        <PreviewNote>
          Preview build: public profiles are demo records, except your own, which is built from your
          wallet and the settings above.
        </PreviewNote>
      </div>
    </>
  );
}
