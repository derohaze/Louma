import { useEffect, useState, type ReactNode } from "react";
import { AlertTriangle, ShieldCheck } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import { Button } from "@/shared/ui/button";
import { Textarea } from "@/shared/ui/textarea";
import { cn } from "@/shared/lib/utils";

export interface ConfirmProps {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: string;
  description?: ReactNode;
  confirmLabel?: string;
  danger?: boolean;
  requireReason?: boolean;
  onConfirm: (reason: string) => void;
}

export function ConfirmationModal({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = "Confirm",
  danger,
  requireReason,
  onConfirm,
}: ConfirmProps) {
  const [reason, setReason] = useState("");
  useEffect(() => {
    if (open) setReason("");
  }, [open]);
  const Icon = danger ? AlertTriangle : ShieldCheck;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="rounded-3xl sm:max-w-md">
        <DialogHeader>
          <span
            className={cn(
              "mb-2 flex size-11 items-center justify-center rounded-2xl",
              danger ? "bg-danger-soft text-destructive" : "bg-primary-soft text-primary",
            )}
          >
            <Icon className="size-5" />
          </span>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        {requireReason && (
          <Textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Reason (required, recorded in audit log)"
            className="rounded-xl"
          />
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant={danger ? "destructive" : "default"}
            disabled={requireReason && reason.trim().length < 3}
            onClick={() => {
              onConfirm(reason.trim() || "—");
              onOpenChange(false);
            }}
          >
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function DangerModal(props: Omit<ConfirmProps, "danger">) {
  return <ConfirmationModal {...props} danger requireReason={props.requireReason ?? true} />;
}

/** Hook-style helper: render <confirm.Modal/> once, call confirm.ask({...}). */
export function useConfirm() {
  const [state, setState] = useState<Omit<ConfirmProps, "open" | "onOpenChange"> | null>(null);
  const Modal = () => {
    if (!state) return null;
    return <ConfirmationModal {...state} open onOpenChange={(o) => !o && setState(null)} />;
  };
  return { ask: setState, Modal };
}
