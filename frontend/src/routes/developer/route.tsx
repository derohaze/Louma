import { Outlet, createFileRoute } from "@tanstack/react-router";

/**
 * Layout for the Developers section. The application catalogue lives in index.tsx, so without this
 * pass-through route `/developer/<page>` would render the parent and swallow the section pages.
 */
export const Route = createFileRoute("/developer")({
  component: () => <Outlet />,
});
