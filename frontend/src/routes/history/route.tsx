import { Outlet, createFileRoute } from "@tanstack/react-router";

/**
 * Layout for the Transactions section. The list lives in index.tsx, so without this
 * pass-through route `/history/<id>` would render the parent and swallow the detail page.
 */
export const Route = createFileRoute("/history")({
  component: () => <Outlet />,
});
