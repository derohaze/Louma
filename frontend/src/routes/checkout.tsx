import { createFileRoute } from "@tanstack/react-router";
import { CheckoutPage } from "@/features/checkout/CheckoutPage";
import { pageHead } from "@/shared/lib/platform";
import type { PaymentMode } from "@/shared/api/payments";
export const Route = createFileRoute("/checkout")({
  validateSearch: (search: Record<string, unknown>): { session: string; mode: PaymentMode } => {
    if (
      typeof search["session"] !== "string" ||
      !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(search["session"]) ||
      (search["mode"] !== "test" && search["mode"] !== "live")
    )
      throw new Error("Invalid checkout reference");
    return { session: search["session"], mode: search["mode"] };
  },
  head: ({ match }) => pageHead("checkout.title", "checkout.description", match.context.language),
  component: CheckoutRoute,
});
function CheckoutRoute() {
  const search = Route.useSearch();
  return <CheckoutPage session={search.session} mode={search.mode} />;
}
