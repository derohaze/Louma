import { Outlet, createFileRoute } from "@tanstack/react-router";

/**
 * Layout for the Mining section. The live cycle lives in index.tsx, so
 * without this pass-through route `/mining/<page>` would render the parent
 * and swallow the section pages.
 */
export const Route = createFileRoute("/mining")({
  component: () => <Outlet />,
});
