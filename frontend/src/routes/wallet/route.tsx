import { Outlet, createFileRoute } from "@tanstack/react-router";

/**
 * Layout for the Wallet section. The balance lives in index.tsx, so without
 * this pass-through route `/wallet/<page>` would render the parent and
 * swallow the section pages.
 */
export const Route = createFileRoute("/wallet")({
  component: () => <Outlet />,
});
