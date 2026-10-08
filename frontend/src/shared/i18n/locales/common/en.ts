/** Words every section reuses. Page-specific copy stays in that page's own folder. */
export default {
  actions: {
    save: "Save",
    saving: "Saving…",
    loading: "Loading…",
    cancel: "Cancel",
    continue: "Continue",
    back: "Back",
    close: "Close",
    refresh: "Refresh",
    retry: "Try again",
    copy: "Copy",
    copied: "Copied",
    copyAddress: "Copy address",
    dismiss: "Dismiss",
  },
  loading: {
    /** Screen-reader status while a page's own skeleton stands in for its content. */
    page: "Loading {title}…",
    pending: "Pending…",
  },
  errors: {
    requestFailed: "The request could not be completed.",
    requestFailedRetry: "The request could not be completed. Try again.",
  },
  state: {
    pro: "Pro",
    free: "Free",
    on: "On",
    off: "Off",
    active: "Active",
    frozen: "Frozen",
    notSet: "Not set",
    none: "—",
    completed: "Completed",
    refused: "The request was refused",
  },
  /** Which way money moved, beside an amount. */
  direction: {
    sent: "Sent",
    received: "Received",
  },
  units: {
    deviceOne: "device",
    deviceOther: "devices",
    sessionOne: "session",
    sessionOther: "sessions",
    cycleOne: "cycle",
    cycleOther: "cycles",
    transferOne: "transfer",
    transferOther: "transfers",
  },
};
