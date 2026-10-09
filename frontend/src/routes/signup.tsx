import { createFileRoute } from "@tanstack/react-router";
import { SignupContent } from "@/features/auth";
import { pageHead } from "@/shared/lib/platform";
import { checkoutReturn } from "@/shared/lib/account/checkout-return";
export const Route = createFileRoute("/signup")({
  validateSearch: checkoutReturn,
  head: ({ match }) =>
    pageHead("auth.signup.title", "auth.signup.description", match.context.language),
  component: SignupRoute,
});
function SignupRoute() {
  return <SignupContent returnTo={Route.useSearch()} />;
}
