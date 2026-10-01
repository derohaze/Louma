import { createFileRoute, redirect } from "@tanstack/react-router";

/** `/history` was renamed to `/transactions`; preserve existing links. */
export const Route = createFileRoute("/history/")({
  beforeLoad: () => {
    throw redirect({ to: "/transactions" });
  },
});
