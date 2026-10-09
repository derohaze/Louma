import { createFileRoute } from "@tanstack/react-router";
import { LoginContent } from "@/features/auth";
import { pageHead } from "@/shared/lib/platform";
import { checkoutReturn } from "@/shared/lib/account/checkout-return";
export const Route = createFileRoute("/login")({
  validateSearch: checkoutReturn,
  head: ({ match }) =>
    pageHead("auth.login.title", "auth.login.description", match.context.language),
  component: LoginRoute,
});
function LoginRoute() {
  return <LoginContent returnTo={Route.useSearch()} />;
}
