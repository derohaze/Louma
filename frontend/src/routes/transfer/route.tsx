import { Outlet, createFileRoute } from "@tanstack/react-router";

/**
 * Layout for the Transfer section. The send form lives in index.tsx, so
 * without this pass-through route `/transfer/<page>` would render the
 * parent and swallow the section pages.
 */
export const Route = createFileRoute("/transfer")({
  component: () => <Outlet />,
});
