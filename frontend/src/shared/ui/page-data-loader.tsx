import { useT } from "@/shared/i18n";
import { cn } from "@/shared/lib/platform";

export function PageDataLoader({ title, className }: { title: string; className?: string }) {
  const t = useT("common");

  return (
    <div
      className={cn("page-data-loader", className)}
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <span className="page-data-loader-spinner" aria-hidden="true" />
      <span className="sr-only">{t("loading.page", { title })}</span>
    </div>
  );
}
