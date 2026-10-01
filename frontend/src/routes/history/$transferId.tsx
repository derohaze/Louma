import { createFileRoute, redirect } from "@tanstack/react-router";

/** `/history/<transferId>` receipts moved to `/transactions/<transferId>`. */
export const Route = createFileRoute("/history/$transferId")({
  beforeLoad: ({ params }) => {
    throw redirect({ to: "/transactions/$transferId", params });
  },
});
