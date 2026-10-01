import { Outlet, createFileRoute } from "@tanstack/react-router";

/**
 * Legacy path kept after the move to `/transactions`: bookmarked or shared
 * `/history` links redirect to their `/transactions` equivalent (see index and
 * `$transferId` below) instead of reaching the not-found page.
 */
export const Route = createFileRoute("/history")({
  component: () => <Outlet />,
});
