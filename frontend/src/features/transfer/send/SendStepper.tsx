import { CheckmarkCircle01Icon } from "@hugeicons/core-free-icons";
import { useT } from "@/shared/i18n";
import { cn } from "@/shared/lib/platform";
import { Icon } from "@/shared/ui/page";

/** The three stages of a send, in the order the wallet asks for them. */
const sendSteps = [
  { id: 1, labelKey: "steps.address" },
  { id: 2, labelKey: "steps.amount" },
  { id: 3, labelKey: "steps.confirm" },
] as const;

export function SendStepper({ stage }: { stage: 1 | 2 | 3 }) {
  const t = useT("transfer.send");
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
              {t(step.labelKey)}
            </span>
            {index < sendSteps.length - 1 && <span aria-hidden className="h-px flex-1 bg-border" />}
          </li>
        );
      })}
    </ol>
  );
}
