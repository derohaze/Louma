import { useEffect, useRef, useState, type ReactNode } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { CheckmarkCircle01Icon, Copy01Icon } from "@hugeicons/core-free-icons";
import { useT } from "@/shared/i18n";
import { Button } from "@/shared/ui/button";

export type IconData = Parameters<typeof HugeiconsIcon>[0]["icon"];

export function Icon({
  icon,
  size = 20,
  className,
}: {
  icon: IconData;
  size?: number;
  className?: string;
}) {
  return <HugeiconsIcon icon={icon} size={size} strokeWidth={1.7} className={className} />;
}

export function PageHeader({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle: string;
  action?: ReactNode;
}) {
  return (
    <div className="mb-5 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="font-display text-2xl font-semibold">{title}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{subtitle}</p>
      </div>
      {action}
    </div>
  );
}

export function EmptyState({
  title,
  detail,
  action,
}: {
  title: string;
  detail: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex min-h-40 flex-col items-center justify-center gap-3 px-5 py-8 text-center">
      <p className="font-semibold">{title}</p>
      <p className="max-w-sm text-sm text-muted-foreground">{detail}</p>
      {action}
    </div>
  );
}

export function CopyButton({ text }: { text: string }) {
  const t = useT("common");
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    },
    [],
  );
  return (
    <Button
      variant="ghost"
      size="icon"
      title={t("actions.copyAddress")}
      aria-label={t("actions.copyAddress")}
      onClick={async () => {
        let copySucceeded = false;
        try {
          await navigator.clipboard.writeText(text);
          copySucceeded = true;
        } catch {
          // Clipboard API needs a secure context: fall back to the legacy execCommand path, whose
          // boolean answer is the only signal that the address actually reached the clipboard.
          const area = document.createElement("textarea");
          area.value = text;
          area.style.position = "fixed";
          area.style.opacity = "0";
          document.body.appendChild(area);
          area.select();
          try {
            copySucceeded = document.execCommand("copy");
          } catch {
            copySucceeded = false;
          }
          area.remove();
        }
        // Never confirm a copy that did not happen: the checkmark would tell the user the address is
        // on their clipboard when it is not.
        if (!copySucceeded) return;
        setCopied(true);
        if (timer.current !== null) window.clearTimeout(timer.current);
        timer.current = window.setTimeout(() => setCopied(false), 1800);
      }}
    >
      <span key={copied ? "copied" : "copy"} className="grid animate-fade-in place-items-center">
        <Icon
          icon={copied ? CheckmarkCircle01Icon : Copy01Icon}
          size={18}
          {...(copied ? { className: "text-success" } : {})}
        />
      </span>
      <span className="sr-only">{t(copied ? "actions.copied" : "actions.copy")}</span>
    </Button>
  );
}
