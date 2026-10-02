import { Button } from "@/shared/ui/button";
import { Icon, type IconData } from "@/shared/ui/page";
import { Loader } from "@/shared/ui/loader";
import { cn } from "@/shared/lib/platform";

/**
 * Action button that keeps its exact size while busy: the label stays in
 * the layout invisibly and the loader overlays it centered, so the button
 * never shrinks or grows when the text swaps for the spinner. While busy
 * the button stays fully opaque (no faded disabled look); extra clicks are
 * ignored by the guard and announced via aria-disabled.
 */
export function MiningBusyButton({
  label,
  icon,
  busy,
  onAction,
  disabled,
  busyLabel,
}: {
  label: string;
  icon: IconData;
  busy: boolean;
  onAction: () => void;
  disabled: boolean;
  busyLabel: string;
}) {
  return (
    <Button
      onClick={() => {
        if (!busy) void onAction();
      }}
      disabled={!busy && disabled}
      aria-disabled={busy || disabled || undefined}
      className="relative"
    >
      <span
        aria-hidden={busy || undefined}
        className={cn("inline-flex items-center gap-2", busy && "invisible motion-reduce:visible")}
      >
        <Icon icon={icon} size={17} />
        {label}
      </span>
      {busy && (
        <span className="absolute inset-0 grid place-items-center motion-reduce:hidden">
          <Loader aria-label={busyLabel} />
        </span>
      )}
    </Button>
  );
}
