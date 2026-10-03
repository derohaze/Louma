import { createFileRoute } from "@tanstack/react-router";
import { ForgotPasswordContent } from "@/features/auth";
import { pageHead } from "@/shared/lib/platform";
export const Route = createFileRoute("/forgot-password")({
  head: ({ match }) =>
    pageHead("auth.forgot.title", "auth.forgot.description", match.context.language),
  component: ForgotPasswordContent,
});
