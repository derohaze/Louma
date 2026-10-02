import { CheckmarkCircle01Icon } from "@hugeicons/core-free-icons";
import { Icon } from "@/shared/ui/page";
import { cn } from "@/shared/lib/platform";

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

export function SendStepper({ stage }: { stage: 1 | 2 | 3 }) {
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
