import { createFileRoute } from "@tanstack/react-router";
import { SignupContent } from "@/features/auth";
import { pageHead } from "@/shared/lib/platform";
export const Route = createFileRoute("/signup")({
  head: ({ match }) =>
    pageHead("auth.signup.title", "auth.signup.description", match.context.language),
  component: SignupContent,
});
