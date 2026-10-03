import { createFileRoute } from "@tanstack/react-router";
import { LoginContent } from "@/features/auth";
import { pageHead } from "@/shared/lib/platform";
export const Route = createFileRoute("/login")({
  head: ({ match }) =>
    pageHead("auth.login.title", "auth.login.description", match.context.language),
  component: LoginContent,
});
