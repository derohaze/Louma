import { createFileRoute } from "@tanstack/react-router";
import { SignupContent } from "@/features/auth";
import { pageHead } from "@/shared/lib/platform";
export const Route = createFileRoute("/signup")({
  head: () => pageHead("auth.signup.title", "auth.signup.description"),
  component: SignupContent,
});
