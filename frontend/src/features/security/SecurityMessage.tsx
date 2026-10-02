import { FormMessage } from "@/shared/ui/panels";

/** Inline error line for the security forms: absent when there is nothing to report. */
export function SecurityErrorText({ error }: { error: string }) {
  return error ? <FormMessage tone="error">{error}</FormMessage> : null;
}
