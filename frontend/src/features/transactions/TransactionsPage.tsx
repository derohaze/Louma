import { useId, useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  ArrowDownLeft01Icon,
  ArrowUpRight01Icon,
  Calendar01Icon,
  Download01Icon,
  FilterIcon,
} from "@hugeicons/core-free-icons";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { EmptyState, Icon, PageHeader, revealDelay } from "@/shared/ui/page";
import { useT } from "@/shared/i18n";
import { useSlidingIndicator, useWallet } from "@/shared/hooks";
import { cn, parseAmount } from "@/shared/lib/platform";
import { displayNote, loadLocalNote } from "@/shared/lib/wallet";
import { downloadCsv, transactionsToCsv } from "@/shared/lib/wallet";
import { currency, moneyToMinorUnits, sumMoney, transactionDateText } from "@/shared/lib/wallet";

/** The Transactions page: searchable, filterable history with CSV export. */
export function TransactionsPage() {
  const t = useT("transactions.list");
  const { transactions, nextCursor, loadMore, userId } = useWallet();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "sent" | "received">("all");
  const advancedFieldsId = useId();
  const { containerRef, activeRef, position } = useSlidingIndicator<
    HTMLDivElement,
    HTMLButtonElement
  >(filter);
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
  const advancedFieldClass = cn(
    "transition-[transform,opacity] duration-300 ease-[cubic-bezier(0.4,0,0.2,1)] motion-reduce:transition-none",
    advancedOpen ? "translate-y-0 opacity-100" : "translate-y-4 opacity-0",
  );
  const advancedFieldStyle = (index: number) => ({
    transitionDelay: advancedOpen ? `${index * 75}ms` : "0ms",
  });
  const filtered = transactions.filter((transaction) => {
    if (filter !== "all" && transaction.direction !== filter) return false;
    // The note is part of what a customer remembers about a transfer, so it is searchable on both
    // sides: the one on record and the personal one this device holds.
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
        title={t("title")}
        subtitle={t("description")}
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
            {t("exportShown", { count: filtered.length })}
          </Button>
        }
      />
      <div style={revealDelay(0)} className="card-enter mb-5 flex flex-col gap-3 sm:flex-row">
        <Input
          aria-label={t("searchAria")}
          placeholder={t("searchPlaceholder")}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setPage(1);
          }}
          className="sm:max-w-xs"
        />
        <div
          ref={containerRef}
          className="relative isolate flex w-fit gap-1 rounded-full border bg-secondary/60 p-1"
        >
          {position && (
            <span
              aria-hidden="true"
              className="pointer-events-none absolute left-0 top-0 z-0 rounded-full bg-card shadow-sm transition-transform duration-300 ease-[cubic-bezier(0.4,0,0.2,1)] will-change-transform motion-reduce:transition-none"
              style={{
                width: position.width,
                height: position.height,
                transform: `translate3d(${position.x}px, ${position.y}px, 0) scale(${position.scaleX}, ${position.scaleY})`,
                transformOrigin: "top left",
              }}
            />
          )}
          {(["all", "sent", "received"] as const).map((item) => (
            <Button
              key={item}
              variant="ghost"
              ref={filter === item ? activeRef : undefined}
              onClick={() => {
                setFilter(item);
                setPage(1);
              }}
              className={cn(
                "relative z-10 h-8 rounded-full px-4 text-xs font-semibold transition-colors duration-200 hover:bg-transparent",
                filter === item
                  ? position
                    ? "text-foreground"
                    : "bg-card text-foreground shadow-sm"
                  : "text-muted-foreground",
              )}
            >
              {t(`filters.${item}`)}
            </Button>
          ))}
        </div>
        <Button
          variant={advancedOpen || hasAdvanced ? "secondary" : "ghost"}
          onClick={() => setAdvancedOpen((open) => !open)}
          className="h-10 w-fit rounded-full px-4 text-xs font-semibold"
          aria-expanded={advancedOpen}
          aria-controls={advancedFieldsId}
        >
          <Icon icon={FilterIcon} size={16} />
          {hasAdvanced ? t("advanced.on") : t("advanced.label")}
        </Button>
      </div>
      <div
        id={advancedFieldsId}
        aria-hidden={!advancedOpen}
        inert={!advancedOpen}
        className={cn(
          "grid transition-[grid-template-rows,opacity] duration-500 ease-[cubic-bezier(0.4,0,0.2,1)] motion-reduce:transition-none",
          advancedOpen ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
        )}
      >
        <div className="min-h-0 overflow-hidden">
          <div className="mb-5 grid gap-3 rounded-[22px] border bg-card p-4 shadow-sm sm:grid-cols-2 lg:grid-cols-4">
            <label
              className={cn("block text-xs font-semibold", advancedFieldClass)}
              style={advancedFieldStyle(0)}
            >
              <span className="mb-1.5 flex items-center gap-1.5 text-muted-foreground">
                <Icon icon={Calendar01Icon} size={15} />
                {t("fields.fromDate")}
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
            <label
              className={cn("block text-xs font-semibold", advancedFieldClass)}
              style={advancedFieldStyle(1)}
            >
              <span className="mb-1.5 flex items-center gap-1.5 text-muted-foreground">
                <Icon icon={Calendar01Icon} size={15} />
                {t("fields.toDate")}
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
            <label
              className={cn("block text-xs font-semibold", advancedFieldClass)}
              style={advancedFieldStyle(2)}
            >
              <span className="mb-1.5 block text-muted-foreground">{t("fields.minAmount")}</span>
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
            <label
              className={cn("block text-xs font-semibold", advancedFieldClass)}
              style={advancedFieldStyle(3)}
            >
              <span className="mb-1.5 block text-muted-foreground">{t("fields.maxAmount")}</span>
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
              <p
                className={cn(
                  "text-xs text-destructive sm:col-span-2 lg:col-span-4",
                  advancedFieldClass,
                )}
                style={advancedFieldStyle(4)}
              >
                {t("amountsError")}
              </p>
            ) : null}
          </div>
        </div>
      </div>
      <div className="mb-4 grid gap-4 sm:grid-cols-4">
        {[
          [t("stats.loaded"), String(transactions.length)],
          [t("stats.sent"), String(sent.length)],
          [t("stats.received"), String(transactions.length - sent.length)],
          [t("stats.tax"), currency(sumMoney(sent.map((item) => item.fee)))],
        ].map(([label, value], index) => (
          <div
            key={label}
            style={revealDelay(index + 1)}
            className="card-enter card-enter-hover rounded-2xl border bg-card p-4 shadow-sm"
          >
            <p className="text-sm text-muted-foreground">{label}</p>
            <strong className="mt-3 block font-display text-2xl">{value}</strong>
          </div>
        ))}
      </div>
      <section
        style={revealDelay(5)}
        className="card-enter overflow-hidden rounded-[22px] border bg-card shadow-sm"
      >
        <div className="border-b bg-secondary/30 px-5 py-4 font-display font-semibold">
          {t("listHeading", { count: filtered.length })}
        </div>
        {shown.length ? (
          shown.map((transaction, row) => {
            const isSent = transaction.direction === "sent";
            const rowNote = displayNote(
              transaction.note,
              loadLocalNote(userId, transaction.transferId),
            );
            return (
              <div
                key={transaction.id}
                style={revealDelay(row, 45, 360)}
                className="list-enter flex flex-wrap items-center gap-3 border-b px-5 py-4 transition-colors hover:bg-secondary/40 last:border-0 motion-reduce:transition-none"
              >
                <span
                  className={cn(
                    "grid size-9 shrink-0 place-items-center rounded-xl",
                    isSent ? "bg-primary/10 text-primary-soft" : "bg-success/10 text-success",
                  )}
                >
                  <Icon icon={isSent ? ArrowUpRight01Icon : ArrowDownLeft01Icon} />
                </span>
                <Link
                  to="/transactions/$transferId"
                  params={{ transferId: transaction.transferId }}
                  className="min-w-0 flex-1"
                >
                  <p className="break-all text-sm font-semibold">
                    {transaction.counterpartyAddress}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {transactionDateText(transaction.createdAt)}
                    {rowNote ? ` · ${rowNote}` : ""}
                  </p>
                </Link>
                {/*
                 * A received transfer credits the net amount: the amount the sender paid includes
                 * the network tax, so showing it here would claim the wallet grew by more than it
                 * did.
                 */}
                <strong
                  className={cn(
                    "shrink-0 text-sm font-semibold tabular-nums",
                    isSent ? "text-primary-soft" : "text-success",
                  )}
                >
                  {isSent ? "-" : "+"}
                  {currency(isSent ? transaction.amount : transaction.netAmount)}
                </strong>
              </div>
            );
          })
        ) : (
          <EmptyState
            title={transactions.length ? t("empty.noMatchTitle") : t("empty.noneTitle")}
            detail={transactions.length ? t("empty.noMatchDetail") : t("empty.noneDetail")}
            action={
              transactions.length ? (
                <Button variant="outline" onClick={clearFilters}>
                  {t("empty.clear")}
                </Button>
              ) : (
                <Link to="/transfer">
                  <Button>{t("empty.transfer")}</Button>
                </Link>
              )
            }
          />
        )}
      </section>
      {(nextCursor || pages > 1) && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          {nextCursor && (
            <Button
              variant="outline"
              disabled={loadingMore}
              onClick={() => {
                setLoadingMore(true);
                void loadMore().finally(() => setLoadingMore(false));
              }}
            >
              {loadingMore ? t("loading") : t("loadOlder")}
            </Button>
          )}
          {pages > 1 && (
            <div className="flex items-center gap-3">
              <Button variant="outline" disabled={page <= 1} onClick={() => setPage(page - 1)}>
                {t("previous")}
              </Button>
              <span className="text-sm">
                {page} / {pages}
              </span>
              <Button variant="outline" disabled={page >= pages} onClick={() => setPage(page + 1)}>
                {t("next")}
              </Button>
            </div>
          )}
        </div>
      )}
    </>
  );
}
