import { Link } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import {
  ArrowDownLeft01Icon,
  ArrowLeft01Icon,
  ArrowRight01Icon,
  ArrowUpRight01Icon,
  BookBookmark01Icon,
  Calendar01Icon,
  CheckmarkCircle01Icon,
  Clock01Icon,
  Delete02Icon,
  Download01Icon,
  FavouriteIcon,
  FilterIcon,
  ImageUpload01Icon,
  Key01Icon,
  NoteEditIcon,
  PercentCircleIcon,
  PlusSignIcon,
  PrinterIcon,
  QrCodeIcon,
  QrCodeScanIcon,
  SquareLock02Icon,
} from "@hugeicons/core-free-icons";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useWallet, type Transaction } from "@/hooks/wallet-context";
import { ApiError, api, messageForError, type ApiTransferPreview } from "@/lib/api";
import {
  LIMITS,
  isTransferTarget,
  normalizeTransferTarget,
  parseAmount,
  sanitizeText,
} from "@/lib/validation";
import {
  consumeTransferPrefill,
  displayNote,
  isSavedAddress,
  loadAddressBook,
  loadLocalNote,
  prefillTransfer,
  removeAddress,
  saveAddress,
  shortAddress,
  type SavedAddress,
} from "@/lib/address-book";
import { downloadCsv, transactionsToCsv } from "@/lib/statements";
import { cn } from "@/lib/utils";
import {
  currency,
  dateText,
  moneyToMinorUnits,
  sumMoney,
  transferNet,
  transferTax,
} from "@/lib/wallet-format";
import { CopyButton, EmptyState, Icon, PageHeader } from "./wallet-shell";
import { FactList, FormMessage, Panel } from "./security-ui";

/**
 * The three stages of a send, in the order the wallet asks for them. Each stage is one question, and
 * the card holds one at a time: an address that does not resolve never reaches the amount, and an
 * amount the ledger refuses never reaches the confirmation.
 */
const sendSteps = [
  { id: 1, label: "Address" },
  { id: 2, label: "Amount" },
  { id: 3, label: "Confirm" },
] as const;

function SendStepper({ stage }: { stage: 1 | 2 | 3 }) {
  return (
    <ol className="mb-5 flex items-center gap-3">
      {sendSteps.map((step, index) => {
        const done = stage > step.id;
        const current = stage === step.id;
        return (
          <li key={step.id} className="flex flex-1 items-center gap-2">
            <span
              aria-current={current ? "step" : undefined}
              className={cn(
                "grid size-7 shrink-0 place-items-center rounded-full border text-xs font-semibold",
                done
                  ? "border-success/40 bg-success/10 text-success"
                  : current
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-secondary text-muted-foreground",
              )}
            >
              {done ? <Icon icon={CheckmarkCircle01Icon} size={16} /> : step.id}
            </span>
            <span
              className={cn(
                "text-xs font-semibold",
                current ? "text-foreground" : "text-muted-foreground",
              )}
            >
              {step.label}
            </span>
            {index < sendSteps.length - 1 && <span aria-hidden className="h-px flex-1 bg-border" />}
          </li>
        );
      })}
    </ol>
  );
}

/** Pulls a transfer target out of decoded QR text, which may carry a prefix or URL. */
function targetFromQrText(text: string): string | null {
  const match = /(LMA(?:-[A-Z0-9]{4}){3}|@[a-z0-9_]{4,24})/i.exec(text);
  return match?.[1] ? normalizeTransferTarget(match[1]) : null;
}

type BarcodeDetectorLike = {
  detect: (source: ImageBitmapSource) => Promise<Array<{ rawValue?: string }>>;
};

/**
 * Inline QR reader for the send form: live camera when the browser can decode
 * frames, image upload otherwise. Stays in context (no modal) so a failed
 * scan leaves the typed address untouched.
 */
function QrScanner({ onDetected }: { onDetected: (address: string) => void }) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const doneRef = useRef(false);
  const [cameraError, setCameraError] = useState("");
  const [working, setWorking] = useState(false);

  const detectorSupported = typeof window !== "undefined" && "BarcodeDetector" in window;

  const stop = () => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  };
  useEffect(() => stop, []);

  const scanFrame = async (detector: BarcodeDetectorLike) => {
    const video = videoRef.current;
    if (!video || doneRef.current) return;
    try {
      const codes = await detector.detect(video);
      const found = codes
        .map((code) => code.rawValue ?? "")
        .map(targetFromQrText)
        .find(Boolean);
      if (found) {
        doneRef.current = true;
        setWorking(false);
        onDetected(found);
        stop();
        return;
      }
    } catch {
      // A single bad frame must not kill the loop; the next one may decode.
    }
    rafRef.current = requestAnimationFrame(() => void scanFrame(detector));
  };

  const startCamera = async () => {
    setCameraError("");
    if (!detectorSupported) {
      setCameraError("This browser cannot read QR codes from the camera. Upload an image instead.");
      return;
    }
    doneRef.current = false;
    setWorking(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" },
      });
      streamRef.current = stream;
      const video = videoRef.current;
      if (!video || doneRef.current) {
        // The scanner was hidden while permission was pending: unmount cleanup ran before a
        // stream existed, so the grant arriving now must release its tracks immediately
        // instead of leaving the camera active with no video element.
        stream.getTracks().forEach((track) => track.stop());
        if (streamRef.current === stream) streamRef.current = null;
        setWorking(false);
        return;
      }
      video.srcObject = stream;
      await video.play();
      const Detector = (
        window as unknown as { BarcodeDetector: new (o: object) => BarcodeDetectorLike }
      ).BarcodeDetector;
      void scanFrame(new Detector({ formats: ["qr_code"] }));
    } catch {
      setWorking(false);
      setCameraError("The camera could not be opened. Check permission, or upload an image.");
    }
  };

  const scanImage = async (file: File) => {
    setCameraError("");
    if (!detectorSupported) {
      setCameraError("This browser cannot read QR codes. Paste the address instead.");
      return;
    }
    setWorking(true);
    try {
      const bitmap = await createImageBitmap(file);
      const Detector = (
        window as unknown as { BarcodeDetector: new (o: object) => BarcodeDetectorLike }
      ).BarcodeDetector;
      const codes = await new Detector({ formats: ["qr_code"] }).detect(bitmap);
      const found = codes
        .map((code) => code.rawValue ?? "")
        .map(targetFromQrText)
        .find(Boolean);
      if (found) onDetected(found);
      else setCameraError("No wallet address was found in that image.");
    } catch {
      setCameraError("That image could not be read. Try a clearer one.");
    } finally {
      setWorking(false);
    }
  };

  return (
    <div className="rounded-xl border bg-secondary/40 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="outline"
          onClick={() => void startCamera()}
          disabled={working}
        >
          <Icon icon={QrCodeScanIcon} size={17} />
          {working ? "Scanning…" : "Scan with camera"}
        </Button>
        <label className="inline-flex h-9 cursor-pointer items-center gap-2 rounded-full border px-4 text-xs font-semibold">
          <Icon icon={ImageUpload01Icon} size={16} />
          Upload QR image
          <input
            type="file"
            accept="image/*"
            className="sr-only"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file) void scanImage(file);
            }}
          />
        </label>
      </div>
      <video
        ref={videoRef}
        muted
        playsInline
        className="mt-3 w-full rounded-xl bg-black"
        aria-label="QR scanner preview"
      />
      {cameraError && <p className="mt-2 text-xs text-destructive">{cameraError}</p>}
      <p className="mt-2 text-xs text-muted-foreground">
        Point at a Louma receive QR. Nothing is filled in until an address is recognised.
      </p>
    </div>
  );
}

export function TransferContent() {
  const { wallet, security, refresh, refreshNotifications, transactions, userId } = useWallet();
  // The overview's Receive action links here with `#receive`; honour it on arrival instead of always
  // opening on Send (the tab the deep link explicitly asked not to see).
  const [tab, setTab] = useState<"send" | "receive">(() =>
    typeof window !== "undefined" && window.location.hash === "#receive" ? "receive" : "send",
  );
  // Keep the address in step with the visible tab: without this the hash still said Receive after the
  // user switched to Send, so refreshing (or re-opening the link) silently flipped them back to the
  // tab they had just left.
  useEffect(() => {
    const desired = tab === "receive" ? "#receive" : "#send";
    if (window.location.hash !== desired) {
      window.history.replaceState(
        window.history.state,
        "",
        `${window.location.pathname}${window.location.search}${desired}`,
      );
    }
  }, [tab]);
  /**
   * The send flow is three stages, and the card only ever holds one of them: what the address costs
   * nothing to check, what an amount costs comes from the ledger, and what leaves the wallet is only
   * decided once both are known and the sender has seen them together.
   */
  const [stage, setStage] = useState<1 | 2 | 3>(1);
  // A "Send" action from the address book stashes the recipient here; it is
  // consumed once so a later visit starts empty again.
  const [address, setAddress] = useState(() => consumeTransferPrefill());
  const [note, setNote] = useState("");
  const [scannerOpen, setScannerOpen] = useState(false);
  /** Bumped when the address book changes, so the shortcut chips re-read it. */
  const [bookTick, setBookTick] = useState(0);
  const [recipient, setRecipient] = useState<ApiTransferPreview["recipient"] | null>(null);
  const [quote, setQuote] = useState<ApiTransferPreview["quote"]>(null);
  /**
   * The server's approval of exactly the intent this card is showing. It is retired whenever the
   * intent changes — an edited address or a fresh quote — because the transfer executes what the
   * approval names: the recipient the server resolved, and the amounts the ledger quoted.
   */
  const [authorization, setAuthorization] = useState<ApiTransferPreview["authorization"]>(null);
  const [amount, setAmount] = useState("");
  /** Which of the account's own credentials is being offered at stage three, when it holds both. */
  const [method, setMethod] = useState<"password" | "code">("password");
  const [credential, setCredential] = useState("");
  const [busy, setBusy] = useState<"address" | "amount" | "send" | null>(null);
  const [error, setError] = useState("");
  const [sent, setSent] = useState<Transaction | null>(null);
  /**
   * One idempotency key per transfer attempt, kept together with the parameters it was minted for.
   * A retry of the same parameters — including a retry after a response that never arrived, the one
   * case where the wallet may already have been debited — reuses the key, so the backend replays the
   * original transfer instead of moving funds twice. Only a confirmed transfer ends the attempt.
   */
  const attempt = useRef<{ key: string; fingerprint: string } | null>(null);
  /** Mirrors the backend's fingerprint: recipient, amounts, and note make two attempts the same one. */
  const attemptFingerprint = (target: string, amountValue: string, noteValue: string) =>
    JSON.stringify([target.trim().toLowerCase(), amountValue, noteValue]);
  const frozen = security?.wallet.status === "frozen";
  const passwordSet = security?.transferPassword.enabled ?? false;
  const authenticatorSet = security?.twoFactor.enabled ?? false;
  /** The account proves one of the credentials it holds; an account with neither may send directly. */
  const needsCredential = passwordSet || authenticatorSet;
  const usingCode = authenticatorSet && (!passwordSet || method === "code");
  const balanceMinor = wallet ? moneyToMinorUnits(wallet.balance) : 0;
  const amountCheck = parseAmount(amount);
  const amountValid = amountCheck.ok;
  const decimalAmount = amountCheck.value;
  /** Stage two's own estimate, so the numbers move with the keystrokes; the quote replaces it. */
  const tax = amountValid ? transferTax(decimalAmount) : "0.0000";
  const net = amountValid ? transferNet(decimalAmount) : "0.0000";
  /** The address is checked against the wallet on every keystroke, before the server is asked. */
  const looksLikeOwnAddress =
    address.length > 0 && address.toLowerCase() === wallet?.address.toLowerCase();
  /** The canonical address the API resolved at stage one: the transfer is sent to exactly this. */
  const verifiedAddress = recipient?.address ?? "";

  /** The verified recipient belongs to the spelling it was verified for: editing retires it. */
  const changeAddress = (value: string) => {
    setAddress(normalizeTransferTarget(value));
    setRecipient(null);
    setQuote(null);
    setAuthorization(null);
    setError("");
  };

  /** Starts a fresh transfer, with nothing carried over from the one that just finished. */
  const startOver = () => {
    setStage(1);
    setAddress("");
    setNote("");
    setScannerOpen(false);
    setRecipient(null);
    setQuote(null);
    setAuthorization(null);
    setAmount("");
    setCredential("");
    setMethod("password");
    setError("");
    setSent(null);
    attempt.current = null;
  };

  /**
   * Stage one: asks the API whether this address exists — a typo, an address nobody holds, and the
   * sender's own wallet are all answered here, before an amount is even discussed.
   */
  const verifyAddress = async () => {
    setError("");
    const target = address.trim();
    if (!isTransferTarget(target)) {
      setError("Enter a Louma wallet address (LMA-XXXX-XXXX-XXXX) or a @handle.");
      return;
    }
    if (target.toLowerCase() === wallet?.address.toLowerCase()) {
      setError("This is your own address. Use another wallet.");
      return;
    }
    setBusy("address");
    try {
      const { preview } = await api.post<{ preview: ApiTransferPreview }>(
        "/api/v1/transfers/preview",
        { recipientAddress: target },
      );
      setRecipient(preview.recipient);
      setQuote(null);
      setAuthorization(null);
      setStage(2);
    } catch (cause) {
      setError(messageForError(cause));
    } finally {
      setBusy(null);
    }
  };

  /** Stage two: the ledger prices the amount, and its own balance decides whether it is affordable. */
  const verifyAmount = async () => {
    setError("");
    if (!amountCheck.ok) {
      setError(amountCheck.error);
      return;
    }
    setBusy("amount");
    try {
      const { preview } = await api.post<{ preview: ApiTransferPreview }>(
        "/api/v1/transfers/preview",
        { recipientAddress: verifiedAddress, amount: amountCheck.value, note },
      );
      if (!preview.quote || !preview.authorization) {
        throw new Error("The amount could not be quoted. Try again.");
      }
      if (!preview.quote.sufficient) {
        setError(
          `That is more than this wallet holds. ${currency(preview.quote.balance)} is available.`,
        );
        return;
      }
      setQuote(preview.quote);
      setAuthorization(preview.authorization);
      setStage(3);
    } catch (cause) {
      setError(messageForError(cause));
    } finally {
      setBusy(null);
    }
  };

  /**
   * Stage three: the money moves. The credential is proven by the API — the page only decides which
   * one it asks for, and never treats its own field as the authority on it.
   */
  const completeTransfer = async () => {
    setError("");
    if (!quote || !recipient) {
      setError("Confirm the recipient and the amount first.");
      return;
    }
    // An approval that belongs to a different intent than the card is showing is not carried
    // forward: this page re-asks for the amount rather than sending something it cannot name.
    if (authorization && (authorization.intent.amount !== quote.amount || authorization.intent.recipientAddress.toLowerCase() !== verifiedAddress.toLowerCase())) {
      setAuthorization(null);
      setQuote(null);
      setStage(2);
      setError("Confirm the amount again so the server can approve it.");
      return;
    }
    if (frozen) {
      setError("The wallet is frozen, so transfers are refused.");
      return;
    }
    if (!authorization) {
      setError("Confirm the amount again so the server can approve it.");
      setStage(2);
      return;
    }
    const proof = credential.trim();
    if (needsCredential && !proof) {
      setError(
        usingCode ? "Enter a code from your authenticator app." : "Enter your transfer password.",
      );
      return;
    }
    if (usingCode && proof.length < 6) {
      setError("That code is too short. Enter the six digits, or a recovery code.");
      return;
    }
    setBusy("send");
    try {
      // The note is part of the fingerprint (as on the server): after an ambiguous send,
      // editing only the note mints a fresh idempotency key instead of reusing the old one
      // and being rejected as `idempotency_key_reused`.
      const fingerprint = attemptFingerprint(verifiedAddress, quote.amount, note);
      const pending =
        attempt.current?.fingerprint === fingerprint
          ? attempt.current
          : { key: crypto.randomUUID(), fingerprint };
      attempt.current = pending;
      const response = await api.post<{ transaction: Transaction }>(
        "/api/v1/transfers",
        {
          authorizationId: authorization.id,
          recipientAddress: verifiedAddress,
          amount: quote.amount,
          note,
          ...(usingCode
            ? { twoFactorCode: proof }
            : passwordSet && proof
              ? { transferPassword: proof }
              : {}),
        },
        { idempotencyKey: pending.key },
      );
      // Only a transfer the API confirmed clears the attempt; a failure keeps its key for the retry.
      attempt.current = null;
      setCredential("");
      setSent(response.transaction);
      // This transfer notified both sides: the bell is told before the account read, because that read
      // now rejects when its fetch fails, and a failed one must not withhold the notice behind it.
      refreshNotifications();
      await refresh();
    } catch (cause) {
      // An approval the server refuses — expired, already spent, or no longer matching — cannot be
      // reused, and guessing a new key would just repeat the refusal: the card returns to the amount
      // stage so the server issues a fresh approval, which is what the caller actually needs.
      if (
        cause instanceof ApiError &&
        (cause.code === "transfer_authorization_expired" ||
          cause.code === "transfer_authorization_used" ||
          cause.code === "transfer_authorization_mismatch")
      ) {
        setAuthorization(null);
        setQuote(null);
        setStage(2);
      }
      setError(messageForError(cause));
    } finally {
      setBusy(null);
    }
  };

  /**
   * Saved addresses first, then recent recipients the wallet already paid —
   * one tap instead of retyping an irreversible address. Re-read whenever the
   * book changes, so saving from this form shows up immediately.
   */
  // `bookTick` is a manual invalidation signal, not a data input.
  const savedShortcuts = useMemo(
    () => loadAddressBook(userId),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [userId, bookTick],
  );
  const recentShortcuts = useMemo(() => {
    const seen = new Set(savedShortcuts.map((entry) => entry.address.toLowerCase()));
    const out: string[] = [];
    for (const tx of transactions) {
      if (tx.direction !== "sent") continue;
      const key = tx.counterpartyAddress.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(tx.counterpartyAddress);
      if (out.length >= 6) break;
    }
    return out;
  }, [transactions, savedShortcuts]);
  const hasShortcuts = savedShortcuts.length > 0 || recentShortcuts.length > 0;

  return (
    <>
      <PageHeader title="Transfer" subtitle="Send or receive LMA between wallet addresses." />
      <div className="mb-5 flex w-fit gap-1 rounded-full border bg-secondary/60 p-1">
        {(["send", "receive"] as const).map((item) => (
          <Button
            key={item}
            variant="ghost"
            onClick={() => setTab(item)}
            className={`h-9 rounded-full px-5 text-xs font-semibold ${tab === item ? "bg-card text-foreground shadow-sm" : "text-muted-foreground"}`}
          >
            {item === "send" ? "Send" : "Receive"}
          </Button>
        ))}
      </div>
      {tab === "send" ? (
        <>
          {!sent && <SendStepper stage={stage} />}
          {frozen && !sent && (
            <p
              role="status"
              className="mb-5 rounded-xl border border-warning bg-warning/10 px-4 py-3 text-sm"
            >
              The wallet is frozen, so every transfer is refused.{" "}
              <Link to="/security/freeze" className="font-semibold text-primary-soft">
                Unfreeze it
              </Link>
              .
            </p>
          )}
          {sent ? (
            <section className="max-w-2xl rounded-[22px] border bg-card p-6 shadow-sm">
              <span className="grid size-11 place-items-center rounded-full bg-success/10 text-success">
                <Icon icon={CheckmarkCircle01Icon} size={24} />
              </span>
              <h2 className="mt-4 font-display text-xl font-semibold">Transfer sent</h2>
              <p className="mt-2 text-sm text-muted-foreground">
                {currency(sent.amount)} left your wallet and {currency(sent.netAmount)} reached{" "}
                {sent.counterpartyAddress}, after the {currency(sent.fee)} network tax.
              </p>
              <div className="mt-5 rounded-xl bg-secondary p-3">
                <p className="text-xs text-muted-foreground">Transfer ID</p>
                <div className="mt-1 flex items-center gap-2">
                  <code className="min-w-0 flex-1 break-all text-xs">{sent.transferId}</code>
                  <CopyButton text={sent.transferId} />
                </div>
              </div>
              <p className="mt-3 text-xs text-muted-foreground">
                Both wallets record this transfer under that id — the sender's history and the
                recipient's.
              </p>
              <div className="mt-5 flex flex-wrap gap-3">
                <Link to="/transactions/$transferId" params={{ transferId: sent.transferId }}>
                  <Button variant="outline">View transaction</Button>
                </Link>
                <Button onClick={startOver}>
                  <Icon icon={ArrowUpRight01Icon} size={17} />
                  New transfer
                </Button>
              </div>
            </section>
          ) : (
            <div className="grid gap-4 xl:grid-cols-[1.5fr_1fr]">
              <section className="rounded-[22px] border bg-card p-5 shadow-sm">
                {stage === 1 && (
                  <form
                    onSubmit={(event) => {
                      event.preventDefault();
                      void verifyAddress();
                    }}
                    className="space-y-4"
                  >
                    {hasShortcuts && (
                      <div>
                        <p className="text-xs font-semibold text-muted-foreground">
                          Saved & recent recipients
                        </p>
                        <div className="mt-2 flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                          {savedShortcuts.map((entry) => (
                            <button
                              key={entry.address}
                              type="button"
                              onClick={() => changeAddress(entry.address)}
                              title={entry.address}
                              className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-primary/30 bg-primary/5 px-3 py-1.5 text-xs font-semibold"
                            >
                              <Icon icon={FavouriteIcon} size={14} className="text-primary-soft" />
                              {entry.label}
                            </button>
                          ))}
                          {recentShortcuts.map((item) => (
                            <button
                              key={item}
                              type="button"
                              onClick={() => changeAddress(item)}
                              title={item}
                              className="inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold text-muted-foreground"
                            >
                              <Icon icon={Clock01Icon} size={14} />
                              {shortAddress(item)}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                    <label className="block text-sm font-semibold">
                      Recipient wallet address
                      <Input
                        autoFocus
                        className="mt-2"
                        required
                        autoComplete="off"
                        spellCheck={false}
                        maxLength={LIMITS.maxRecipientLength}
                        placeholder="LMA-XXXX-XXXX-XXXX or @handle"
                        value={address}
                        onChange={(event) => changeAddress(event.target.value)}
                      />
                    </label>
                    {looksLikeOwnAddress && (
                      <p className="text-xs text-destructive">This is your own address.</p>
                    )}
                    <p className="text-xs text-muted-foreground">
                      Nothing leaves your wallet at this step: the address is checked against the
                      ledger before an amount is even asked for.
                    </p>
                    {error && <FormMessage tone="error">{error}</FormMessage>}
                    <div className="flex flex-wrap items-center gap-3">
                      <Button type="submit" disabled={busy !== null || frozen || !address.trim()}>
                        {busy === "address" ? "Checking the address…" : "Continue"}
                        <Icon icon={ArrowRight01Icon} size={16} />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        className="h-9 rounded-full px-4 text-xs font-semibold"
                        onClick={() => setScannerOpen((open) => !open)}
                      >
                        <Icon icon={QrCodeScanIcon} size={16} />
                        {scannerOpen ? "Hide scanner" : "Scan QR"}
                      </Button>
                    </div>
                    {scannerOpen && (
                      <QrScanner
                        onDetected={(detected) => {
                          changeAddress(detected);
                          setScannerOpen(false);
                        }}
                      />
                    )}
                  </form>
                )}
                {stage === 2 && recipient && (
                  <form
                    onSubmit={(event) => {
                      event.preventDefault();
                      void verifyAmount();
                    }}
                    className="space-y-4"
                  >
                    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-success/40 bg-success/10 p-3">
                      <Icon icon={CheckmarkCircle01Icon} size={18} className="text-success" />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold">Address verified</p>
                        <code className="break-all text-xs">{recipient.address}</code>
                        {recipient.displayName && (
                          <p className="text-xs text-muted-foreground">
                            Wallet owner · {recipient.displayName}
                          </p>
                        )}
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        className="h-8 rounded-full px-3 text-xs font-semibold"
                        onClick={() => {
                          setStage(1);
                          setQuote(null);
                          setError("");
                        }}
                      >
                        Change
                      </Button>
                      {isSavedAddress(userId, verifiedAddress) ? (
                        <span className="inline-flex items-center gap-1 text-xs font-semibold text-primary-soft">
                          <Icon icon={FavouriteIcon} size={15} />
                          Saved
                        </span>
                      ) : (
                        <Button
                          type="button"
                          variant="ghost"
                          className="h-8 rounded-full px-3 text-xs font-semibold"
                          onClick={() => {
                            saveAddress(userId, verifiedAddress, recipient.displayName ?? "");
                            setBookTick((tick) => tick + 1);
                          }}
                        >
                          <Icon icon={FavouriteIcon} size={15} />
                          Save
                        </Button>
                      )}
                    </div>
                    <label className="block text-sm font-semibold">
                      Amount (LMA)
                      <Input
                        autoFocus
                        className="mt-2"
                        required
                        inputMode="decimal"
                        autoComplete="off"
                        maxLength={LIMITS.maxAmountLength}
                        placeholder="0.0000"
                        value={amount}
                        onChange={(event) => {
                          setAmount(event.target.value);
                          setQuote(null);
                          setError("");
                        }}
                      />
                    </label>
                    {amount.trim() && !amountValid && (
                      <p className="text-xs text-destructive">{amountCheck.error}</p>
                    )}
                    {amountValid && (
                      <div className="flex items-start gap-2 rounded-xl bg-secondary/60 p-3 text-xs">
                        <Icon icon={PercentCircleIcon} size={17} className="mt-0.5 shrink-0" />
                        <div>
                          <p>
                            Network tax (1%): <strong>{currency(tax)}</strong>
                          </p>
                          <p className="mt-1 text-muted-foreground">
                            {currency(decimalAmount)} leaves your wallet and {currency(net)} reaches
                            the recipient.
                          </p>
                        </div>
                      </div>
                    )}
                    {balanceMinor <= 0 && (
                      <p className="text-sm text-muted-foreground">
                        No funds available. Share your receiving address to receive LMA first.
                      </p>
                    )}
                    <label className="block text-sm font-semibold">
                      Note (optional)
                      <Input
                        className="mt-2"
                        autoComplete="off"
                        maxLength={LIMITS.maxNoteLength}
                        placeholder="What is this transfer for?"
                        value={note}
                        onChange={(event) => {
                          setNote(event.target.value);
                          setError("");
                        }}
                      />
                    </label>
                    {error && <FormMessage tone="error">{error}</FormMessage>}
                    <div className="flex flex-wrap items-center gap-3">
                      <Button
                        type="button"
                        variant="outline"
                        disabled={busy !== null}
                        onClick={() => {
                          setStage(1);
                          setError("");
                        }}
                      >
                        <Icon icon={ArrowLeft01Icon} size={16} />
                        Back
                      </Button>
                      <Button type="submit" disabled={busy !== null || !amountValid || frozen}>
                        {busy === "amount" ? "Checking the ledger…" : "Continue"}
                        <Icon icon={ArrowRight01Icon} size={16} />
                      </Button>
                    </div>
                  </form>
                )}
                {stage === 3 && recipient && quote && (
                  <div className="space-y-4">
                    <div className="overflow-hidden rounded-xl border">
                      {[
                        ["Recipient", verifiedAddress],
                        ["Network tax (1%)", currency(quote.fee)],
                        ["Amount (LMA)", currency(quote.amount)],
                        ["Recipient receives", currency(quote.netAmount)],
                        ["Balance after", currency(quote.balanceAfter)],
                        ...(note.trim() ? ([["Note", note.trim()]] as [string, string][]) : []),
                      ].map(([label, value]) => (
                        <div
                          key={label}
                          className="flex items-start justify-between gap-4 border-b px-4 py-3 last:border-0"
                        >
                          <span className="shrink-0 text-sm text-muted-foreground">{label}</span>
                          <span
                            className={cn(
                              "min-w-0 text-end text-sm font-semibold",
                              label === "Recipient" && "break-all",
                            )}
                          >
                            {value}
                          </span>
                        </div>
                      ))}
                    </div>
                    {recipient.displayName && (
                      <p className="text-xs text-muted-foreground">
                        Paying the wallet held by {recipient.displayName}. Check both sides of the
                        address before sending: a transfer cannot be reversed.
                      </p>
                    )}
                    {needsCredential && (
                      <div className="space-y-3 rounded-xl border p-4">
                        <div className="flex items-center gap-2 text-sm font-semibold">
                          <Icon icon={usingCode ? Key01Icon : SquareLock02Icon} size={18} />
                          {usingCode ? "Authenticator code" : "Transfer password"}
                        </div>
                        {passwordSet && authenticatorSet && (
                          <div className="flex w-fit gap-1 rounded-full border bg-secondary/60 p-1">
                            {(
                              [
                                ["password", "Transfer password"],
                                ["code", "Authenticator"],
                              ] as const
                            ).map(([value, label]) => (
                              <Button
                                key={value}
                                type="button"
                                variant="ghost"
                                onClick={() => {
                                  setMethod(value);
                                  setCredential("");
                                  setError("");
                                }}
                                className={cn(
                                  "h-8 rounded-full px-4 text-xs font-semibold",
                                  method === value
                                    ? "bg-card text-foreground shadow-sm"
                                    : "text-muted-foreground",
                                )}
                              >
                                {label}
                              </Button>
                            ))}
                          </div>
                        )}
                        <Input
                          type={usingCode ? "text" : "password"}
                          autoComplete={usingCode ? "one-time-code" : "off"}
                          spellCheck={false}
                          maxLength={usingCode ? 64 : LIMITS.maxPasswordLength}
                          value={credential}
                          onChange={(event) => {
                            setCredential(event.target.value);
                            setError("");
                          }}
                          placeholder={
                            usingCode ? "6-digit code or a recovery code" : "Your transfer password"
                          }
                        />
                        <p className="text-xs text-muted-foreground">
                          {usingCode
                            ? "The code proves the transfer with your authenticator; a recovery code works too."
                            : "Proved by the API before the ledger moves, never stored by this page."}
                        </p>
                      </div>
                    )}
                    {!needsCredential && (
                      <p className="text-xs text-muted-foreground">
                        This wallet has no transfer password and no authenticator, so it sends as
                        soon as you confirm. A credential can be set from the Security section.
                      </p>
                    )}
                    {error && <FormMessage tone="error">{error}</FormMessage>}
                    <div className="flex flex-wrap items-center gap-3">
                      <Button
                        variant="outline"
                        disabled={busy !== null}
                        onClick={() => {
                          setStage(2);
                          setError("");
                        }}
                      >
                        <Icon icon={ArrowLeft01Icon} size={16} />
                        Back
                      </Button>
                      <Button disabled={busy !== null} onClick={() => void completeTransfer()}>
                        <Icon icon={ArrowUpRight01Icon} size={17} />
                        {busy === "send" ? "Sending…" : `Send ${currency(quote.amount)}`}
                      </Button>
                    </div>
                  </div>
                )}
              </section>
              <aside className="h-fit space-y-4">
                <section className="rounded-[22px] border bg-card p-5 shadow-sm">
                  <p className="text-sm text-muted-foreground">Available balance</p>
                  <p className="mt-3 font-display text-2xl font-bold">
                    {currency(wallet?.balance ?? "0")}
                  </p>
                  <p className="mt-5 text-sm text-muted-foreground">
                    The 1% network tax is taken from what the sender pays; the recipient receives
                    the rest.
                  </p>
                </section>
                <section className="rounded-[22px] border bg-card p-5 shadow-sm">
                  <div className="flex items-center gap-2 text-sm font-semibold">
                    <Icon icon={needsCredential ? Key01Icon : SquareLock02Icon} size={18} />
                    {needsCredential ? "A credential is required" : "No credential is set"}
                  </div>
                  <p className="mt-3 text-sm text-muted-foreground">
                    {needsCredential
                      ? `This wallet accepts ${
                          passwordSet && authenticatorSet
                            ? "your transfer password or an authenticator code"
                            : passwordSet
                              ? "your transfer password"
                              : "an authenticator code"
                        } before any LMA leaves it.`
                      : "Without a transfer password or an authenticator, a signed-in session can move funds on its own."}
                  </p>
                  {!needsCredential && (
                    <Link
                      to="/security"
                      className="mt-3 inline-block text-xs font-semibold text-primary-soft"
                    >
                      Set up a credential
                    </Link>
                  )}
                  <p className="mt-4 text-sm text-muted-foreground">
                    Transfers are final after submission. Nothing moves until the last step.
                  </p>
                </section>
              </aside>
            </div>
          )}
        </>
      ) : (
        <section className="max-w-3xl rounded-[22px] border bg-card p-5 shadow-sm">
          <div className="flex items-center gap-2 font-semibold">
            <Icon icon={QrCodeIcon} />
            Your receiving address
          </div>
          <div className="mt-5 flex flex-col items-start gap-5 sm:flex-row">
            {/* The QR is generated in the browser, so the address never leaves the page. */}
            <div className="rounded-2xl border bg-white p-4">
              <QRCodeSVG
                value={wallet?.address ?? ""}
                size={168}
                level="M"
                marginSize={1}
                fgColor="#20123A"
                bgColor="#FFFFFF"
                aria-label="Receiving address QR code"
              />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm text-muted-foreground">
                Scan the code, or share the address with the sender to receive LMA.
              </p>
              <div className="mt-3 flex items-center gap-2 rounded-xl bg-secondary p-3">
                <code className="min-w-0 flex-1 break-all">{wallet?.address}</code>
                {wallet?.address && <CopyButton text={wallet.address} />}
              </div>
              <p className="mt-3 text-xs text-muted-foreground">
                A 1% network tax applies to every transfer on the network, and it is taken from what
                the sender pays.
              </p>
            </div>
          </div>
        </section>
      )}
    </>
  );
}

export function WalletContent() {
  const { wallet, transactions } = useWallet();
  return (
    <>
      <PageHeader
        title="Wallet"
        subtitle="Your wallet balance and receiving address."
        action={
          <Link to="/transfer">
            <Button>
              <Icon icon={ArrowUpRight01Icon} size={17} />
              Transfer
            </Button>
          </Link>
        }
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <section className="rounded-[22px] border bg-card p-5 shadow-sm">
          <p className="text-sm text-muted-foreground">Available balance</p>
          <p className="mt-4 font-display text-3xl font-bold">{currency(wallet?.balance ?? "0")}</p>
          <p className="mt-4 text-xs text-muted-foreground">
            {transactions.length} recorded transactions
          </p>
        </section>
        <section className="rounded-[22px] border bg-card p-5 shadow-sm">
          <p className="text-sm font-semibold">Primary address</p>
          <div className="mt-4 flex items-center gap-2 rounded-xl bg-secondary p-3">
            <code className="min-w-0 flex-1 break-all text-sm">{wallet?.address}</code>
            {wallet?.address && <CopyButton text={wallet.address} />}
          </div>
          <p className="mt-4 text-xs text-muted-foreground">Only send LMA to this address.</p>
        </section>
      </div>
      <section className="mt-4 rounded-[22px] border bg-card p-5 shadow-sm">
        <h2 className="font-display font-semibold">Wallet details</h2>
        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          {[
            ["Receiving address", wallet?.address ?? "—"],
            ["Status", wallet?.status === "frozen" ? "Frozen" : "Active"],
            ["Created", wallet?.createdAt ? dateText(wallet.createdAt) : "—"],
          ].map(([label, value]) => (
            <div key={label}>
              <p className="text-xs text-muted-foreground">{label}</p>
              <p className="mt-2 text-sm font-semibold">{value}</p>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}

export function AddressBookContent() {
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

export function RecipientsContent() {
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
      <p className="mt-4 text-xs text-muted-foreground">
        Manage names in the{" "}
        <Link to="/wallet/address-book" className="font-semibold text-primary-soft">
          address book
        </Link>
        .
      </p>
    </>
  );
}

export function HistoryContent() {
  const { transactions, nextCursor, loadMore, userId } = useWallet();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "sent" | "received">("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [minAmount, setMinAmount] = useState("");
  const [maxAmount, setMaxAmount] = useState("");
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [page, setPage] = useState(1);
  const [loadingMore, setLoadingMore] = useState(false);
  const pageSize = 8;
  const resetPage = () => setPage(1);
  const minCheck = minAmount.trim() ? parseAmount(minAmount.trim()) : null;
  const maxCheck = maxAmount.trim() ? parseAmount(maxAmount.trim()) : null;
  const fromMs = dateFrom ? new Date(`${dateFrom}T00:00:00`).getTime() : NaN;
  const toMs = dateTo ? new Date(`${dateTo}T23:59:59.999`).getTime() : NaN;
  const hasAdvanced = Boolean(dateFrom || dateTo || minAmount.trim() || maxAmount.trim());
  const filtered = transactions.filter((transaction) => {
    if (filter !== "all" && transaction.direction !== filter) return false;
    const localNote = loadLocalNote(userId, transaction.transferId);
    if (
      query &&
      !`${transaction.counterpartyAddress} ${transaction.note} ${localNote} ${transaction.transferId}`
        .toLowerCase()
        .includes(query.toLowerCase())
    )
      return false;
    const createdMs = new Date(transaction.createdAt).getTime();
    if (!Number.isNaN(fromMs) && createdMs < fromMs) return false;
    if (!Number.isNaN(toMs) && createdMs > toMs) return false;
    if ((minCheck?.ok || maxCheck?.ok) && (minCheck || maxCheck)) {
      let minor = 0;
      try {
        minor = moneyToMinorUnits(
          transaction.direction === "sent" ? transaction.amount : transaction.netAmount,
        );
      } catch {
        minor = 0;
      }
      if (minCheck?.ok && minor < moneyToMinorUnits(minCheck.value)) return false;
      if (maxCheck?.ok && minor > moneyToMinorUnits(maxCheck.value)) return false;
    }
    return true;
  });
  const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const shown = filtered.slice((page - 1) * pageSize, page * pageSize);
  const sent = transactions.filter((item) => item.direction === "sent");
  const clearFilters = () => {
    setQuery("");
    setFilter("all");
    setDateFrom("");
    setDateTo("");
    setMinAmount("");
    setMaxAmount("");
    setPage(1);
  };
  return (
    <>
      <PageHeader
        title="Transactions"
        subtitle="Search and filter your transactions."
        action={
          <Button
            variant="outline"
            disabled={!filtered.length}
            onClick={() =>
              downloadCsv(
                `louma-transactions-${new Date().toISOString().slice(0, 10)}.csv`,
                transactionsToCsv(filtered, userId),
              )
            }
          >
            <Icon icon={Download01Icon} size={17} />
            Export shown ({filtered.length})
          </Button>
        }
      />
      <div className="mb-5 flex flex-col gap-3 sm:flex-row">
        <Input
          aria-label="Search transactions"
          placeholder="Search address, note, or transfer ID"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setPage(1);
          }}
          className="sm:max-w-xs"
        />
        <div className="flex w-fit gap-1 rounded-full border bg-secondary/60 p-1">
          {(["all", "sent", "received"] as const).map((item) => (
            <Button
              key={item}
              variant="ghost"
              onClick={() => {
                setFilter(item);
                setPage(1);
              }}
              className={`h-8 rounded-full px-4 text-xs font-semibold ${filter === item ? "bg-card text-foreground shadow-sm" : "text-muted-foreground"}`}
            >
              {item.charAt(0).toUpperCase() + item.slice(1)}
            </Button>
          ))}
        </div>
        <Button
          variant={advancedOpen || hasAdvanced ? "secondary" : "ghost"}
          onClick={() => setAdvancedOpen((open) => !open)}
          className="h-10 w-fit rounded-full px-4 text-xs font-semibold"
          aria-expanded={advancedOpen}
        >
          <Icon icon={FilterIcon} size={16} />
          Advanced{hasAdvanced ? " · on" : ""}
        </Button>
      </div>
      {advancedOpen && (
        <div className="mb-5 grid gap-3 rounded-[22px] border bg-card p-4 shadow-sm sm:grid-cols-2 lg:grid-cols-4">
          <label className="block text-xs font-semibold">
            <span className="mb-1.5 flex items-center gap-1.5 text-muted-foreground">
              <Icon icon={Calendar01Icon} size={15} />
              From date
            </span>
            <Input
              type="date"
              value={dateFrom}
              max={dateTo || undefined}
              onChange={(event) => {
                setDateFrom(event.target.value);
                resetPage();
              }}
            />
          </label>
          <label className="block text-xs font-semibold">
            <span className="mb-1.5 flex items-center gap-1.5 text-muted-foreground">
              <Icon icon={Calendar01Icon} size={15} />
              To date
            </span>
            <Input
              type="date"
              value={dateTo}
              min={dateFrom || undefined}
              onChange={(event) => {
                setDateTo(event.target.value);
                resetPage();
              }}
            />
          </label>
          <label className="block text-xs font-semibold">
            <span className="mb-1.5 block text-muted-foreground">Min amount (LMA)</span>
            <Input
              inputMode="decimal"
              placeholder="0.0000"
              autoComplete="off"
              value={minAmount}
              onChange={(event) => {
                setMinAmount(event.target.value);
                resetPage();
              }}
            />
          </label>
          <label className="block text-xs font-semibold">
            <span className="mb-1.5 block text-muted-foreground">Max amount (LMA)</span>
            <Input
              inputMode="decimal"
              placeholder="0.0000"
              autoComplete="off"
              value={maxAmount}
              onChange={(event) => {
                setMaxAmount(event.target.value);
                resetPage();
              }}
            />
          </label>
          {(minAmount.trim() && minCheck && !minCheck.ok) ||
          (maxAmount.trim() && maxCheck && !maxCheck.ok) ? (
            <p className="text-xs text-destructive sm:col-span-2 lg:col-span-4">
              Amounts must be positive numbers with up to four decimals.
            </p>
          ) : null}
        </div>
      )}
      <div className="mb-4 grid gap-4 sm:grid-cols-4">
        {[
          ["Loaded transactions", String(transactions.length)],
          ["Sent", String(sent.length)],
          ["Received", String(transactions.length - sent.length)],
          ["Network tax paid", currency(sumMoney(sent.map((item) => item.fee)))],
        ].map(([label, value]) => (
          <div key={label} className="rounded-2xl border bg-card p-4 shadow-sm">
            <p className="text-sm text-muted-foreground">{label}</p>
            <strong className="mt-3 block font-display text-2xl">{value}</strong>
          </div>
        ))}
      </div>
      <section className="overflow-hidden rounded-[22px] border bg-card shadow-sm">
        <div className="border-b px-5 py-4 font-display font-semibold">
          Transactions · {filtered.length} shown
        </div>
        {shown.length ? (
          shown.map((transaction) => {
            const isSent = transaction.direction === "sent";
            const rowNote = displayNote(
              transaction.note,
              loadLocalNote(userId, transaction.transferId),
            );
            return (
              <div
                key={transaction.id}
                className="flex flex-wrap items-center gap-3 border-b px-5 py-4 last:border-0"
              >
                <Icon
                  icon={isSent ? ArrowUpRight01Icon : ArrowDownLeft01Icon}
                  className={isSent ? "text-primary-soft" : "text-success"}
                />
                <Link
                  to="/transactions/$transferId"
                  params={{ transferId: transaction.transferId }}
                  className="min-w-0 flex-1"
                >
                  <p className="break-all text-sm font-semibold">
                    {transaction.counterpartyAddress}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {dateText(transaction.createdAt)}
                    {rowNote ? ` · ${rowNote}` : ""}
                  </p>
                </Link>
                {/*
                 * A received transfer credits the net amount: the amount the sender paid includes
                 * the network tax, so showing it here would claim the wallet grew by more than it
                 * did.
                 */}
                <strong className="text-sm">
                  {isSent ? "-" : "+"}
                  {currency(isSent ? transaction.amount : transaction.netAmount)}
                </strong>
              </div>
            );
          })
        ) : (
          <EmptyState
            title={transactions.length ? "No matching transactions" : "No transactions yet"}
            detail={
              transactions.length
                ? "Try another search or filter."
                : "Send or receive LMA to see your transactions here."
            }
            action={
              transactions.length ? (
                <Button variant="outline" onClick={clearFilters}>
                  Clear filters
                </Button>
              ) : (
                <Link to="/transfer">
                  <Button>Transfer</Button>
                </Link>
              )
            }
          />
        )}
      </section>
      {(nextCursor || pages > 1) && (
        <div className="mt-4 flex items-center justify-between gap-3">
          {nextCursor && (
            <Button
              variant="outline"
              disabled={loadingMore}
              onClick={() => {
                setLoadingMore(true);
                void loadMore().finally(() => setLoadingMore(false));
              }}
            >
              {loadingMore ? "Loading…" : "Load older transactions"}
            </Button>
          )}
          {pages > 1 && (
            <div className="flex items-center gap-3">
              <Button variant="outline" disabled={page <= 1} onClick={() => setPage(page - 1)}>
                Previous
              </Button>
              <span className="text-sm">
                {page} / {pages}
              </span>
              <Button variant="outline" disabled={page >= pages} onClick={() => setPage(page + 1)}>
                Next
              </Button>
            </div>
          )}
        </div>
      )}
    </>
  );
}

export function CustomAddressContent() {
  const { wallet, refresh } = useWallet();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const next = wallet?.customAddressChangedAt
    ? new Date(new Date(wallet.customAddressChangedAt).getTime() + 30 * 86400000)
    : null;
  const waiting = next && next.getTime() > Date.now();
  /** The handle is what the backend stores; the address shown includes the leading "@". */
  const handle = (wallet?.customAddress ?? "").replace(/^@/, "");
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    setError("");
    try {
      await api.patch("/api/v1/wallet/custom-address", { address: name.trim().toLowerCase() });
      setMessage("Address updated.");
      setName("");
      await refresh();
    } catch (cause) {
      setError(messageForError(cause));
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <PageHeader
        title="Custom Address"
        subtitle="Set a memorable receiving address for your wallet."
      />
      <section className="max-w-2xl rounded-[22px] border bg-card p-5 shadow-sm">
        <p className="text-sm text-muted-foreground">Current address</p>
        <div className="mt-2 flex items-center gap-2 rounded-xl bg-secondary p-3">
          <code className="min-w-0 flex-1 break-all">{wallet?.address}</code>
          {wallet?.address && <CopyButton text={wallet.address} />}
        </div>
        <p className="mt-5 text-sm">You can change your custom address once every 30 days.</p>
        {waiting ? (
          <p className="mt-5 rounded-xl border bg-secondary p-4 text-sm">
            Next change available on {next.toLocaleDateString()}.
          </p>
        ) : (
          <form onSubmit={(event) => void submit(event)} className="mt-5 space-y-4">
            <label className="block text-sm font-semibold">
              New address
              <div className="mt-2 flex items-center gap-1 rounded-md border px-3">
                <span>@</span>
                <Input
                  required
                  minLength={4}
                  maxLength={24}
                  pattern="[a-z0-9_]{4,24}"
                  value={name}
                  onChange={(event) => setName(event.target.value.toLowerCase())}
                  placeholder="your_name"
                  className="border-0 shadow-none"
                />
              </div>
            </label>
            <Button disabled={busy}>{busy ? "Saving…" : "Save address"}</Button>
            {error && <FormMessage tone="error">{error}</FormMessage>}
            {message && <FormMessage tone="ok">{message}</FormMessage>}
          </form>
        )}
        <div className="mt-5">
          <Panel title="How it works" description="What the custom address changes.">
            <FactList
              items={[
                ["Handle", handle ? `@${handle}` : "Not set"],
                ["Used for", "Receiving LMA as an alternative to the wallet address"],
                ["Changes", "Once every 30 days"],
              ]}
            />
          </Panel>
        </div>
      </section>
    </>
  );
}
