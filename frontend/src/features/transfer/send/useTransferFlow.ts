import { useMemo, useRef, useState } from "react";
import { useWallet, type Transaction } from "@/shared/hooks";
import { ApiError, api, messageForError, type ApiTransferPreview } from "@/shared/api";
import { isTransferTarget, normalizeTransferTarget, parseAmount } from "@/shared/lib/platform";
import { loadAddressBook } from "@/shared/lib/wallet";
import { consumeTransferPrefill } from "@/shared/lib/wallet";
import { moneyToMinorUnits, transferNet, transferTax } from "@/shared/lib/wallet";

/**
 * The send-flow state machine: three stages (address → amount → confirm), the server's quote and
 * approval for the intent on screen, and the idempotency key that makes a retry safe.
 *
 * The card only ever holds one stage: an address that does not resolve never reaches the amount,
 * and an amount the ledger refuses never reaches the confirmation. The approval is retired whenever
 * the intent changes, because the transfer executes what the approval names.
 */
export function useTransferFlow() {
  const { wallet, security, refresh, refreshNotifications, transactions, userId } = useWallet();

  const [stage, setStage] = useState<1 | 2 | 3>(1);
  // A "Send" action from the address book stashes the recipient here; it is
  // consumed once so a later visit starts empty again.
  const [address, setAddress] = useState(() => consumeTransferPrefill());
  const [note, setNote] = useState("");
  /** Bumped when the address book changes, so the shortcut chips re-read it. */
  const [bookTick, setBookTick] = useState(0);
  const [recipient, setRecipient] = useState<ApiTransferPreview["recipient"] | null>(null);
  const [quote, setQuote] = useState<ApiTransferPreview["quote"]>(null);
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
        setError(`That is more than this wallet holds. ${preview.quote.balance} is available.`);
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
    if (
      authorization &&
      (authorization.intent.amount !== quote.amount ||
        authorization.intent.recipientAddress.toLowerCase() !== verifiedAddress.toLowerCase())
    ) {
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
   * Saved addresses first — one tap instead of retyping an irreversible
   * address. Re-read whenever the book changes, so saving from this form
   * shows up immediately.
   */
  // `bookTick` is a manual invalidation signal, not a data input.
  const savedShortcuts = useMemo(
    () => loadAddressBook(userId),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [userId, bookTick],
  );
  const hasShortcuts = savedShortcuts.length > 0;

  return {
    wallet,
    userId,
    transactions,
    stage,
    setStage,
    address,
    note,
    setNote,
    setBookTick,
    recipient,
    quote,
    setQuote,
    setAuthorization,
    amount,
    setAmount,
    method,
    setMethod,
    credential,
    setCredential,
    busy,
    error,
    setError,
    sent,
    frozen,
    passwordSet,
    authenticatorSet,
    needsCredential,
    usingCode,
    balanceMinor,
    amountCheck,
    amountValid,
    decimalAmount,
    tax,
    net,
    looksLikeOwnAddress,
    verifiedAddress,
    savedShortcuts,
    hasShortcuts,
    changeAddress,
    startOver,
    verifyAddress,
    verifyAmount,
    completeTransfer,
  };
}

export type TransferFlow = ReturnType<typeof useTransferFlow>;
