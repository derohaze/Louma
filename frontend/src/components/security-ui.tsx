import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Shared building blocks for the Security and Settings pages. Both sections are lists of cards, so
 * the card, the status pill, and the key/value list are defined once here and reused everywhere
 * instead of being re-styled page by page.
 */
export function Panel({
  title,
  description,
  action,
  children,
  tone = "default",
  bodyClassName,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
  /** `danger` draws attention to irreversible account actions. */
  tone?: "default" | "danger";
  /** `p-0` for panels whose body is a full-bleed list. */
  bodyClassName?: string;
}) {
  return (
    <section
      className={cn(
        "rounded-[22px] border bg-card shadow-sm",
        tone === "danger" && "border-destructive/40",
      )}
    >
      <div className="flex flex-wrap items-center gap-3 border-b px-5 py-4">
        <div className="min-w-0 flex-1">
          <h2 className="font-display font-semibold">{title}</h2>
          {description && <p className="mt-1 text-xs text-muted-foreground">{description}</p>}
        </div>
        {action}
      </div>
      <div className={cn("p-5", bodyClassName)}>{children}</div>
    </section>
  );
}

/** Whether a protection is on. Colour alone never carries the meaning. */
export function StatusPill({
  enabled,
  on = "On",
  off = "Off",
}: {
  enabled: boolean;
  on?: string;
  off?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold",
        enabled
          ? "border-success/40 bg-success/10 text-[#1F7A5A]"
          : "border-border bg-secondary text-[#58585E]",
      )}
    >
      <span
        aria-hidden
        className={cn("size-1.5 rounded-full", enabled ? "bg-success" : "bg-muted-foreground")}
      />
      {enabled ? on : off}
    </span>
  );
}

/** Key/value facts, e.g. the current session or the wallet identity. */
export function FactList({ items }: { items: [string, ReactNode][] }) {
  return (
    <dl className="grid gap-4 sm:grid-cols-2">
      {items.map(([label, value]) => (
        <div key={label} className="min-w-0">
          <dt className="text-xs text-muted-foreground">{label}</dt>
          <dd className="mt-1.5 text-sm font-semibold">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Inline outcome message for a saved setting or a rejected input. */
export function FormMessage({ tone, children }: { tone: "ok" | "error"; children: ReactNode }) {
  return (
    <p
      role="status"
      className={cn("text-sm", tone === "ok" ? "text-muted-foreground" : "text-destructive")}
    >
      {children}
    </p>
  );
}
