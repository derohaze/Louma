import { createFileRoute } from "@tanstack/react-router";
import { CheckoutPage } from "@/features/checkout/CheckoutPage";
import { pageHead } from "@/shared/lib/platform";
import type { PaymentMode } from "@/shared/api/payments";
import { lazy, Suspense } from "react";
const Preview = import.meta.env.DEV
  ? lazy(() => import("@/features/checkout/CheckoutPreview"))
  : null;
export const Route = createFileRoute("/checkout")({
  validateSearch: (
    search: Record<string, unknown>,
  ): { session: string; mode: PaymentMode; preview?: boolean } => {
    if (
      import.meta.env.DEV &&
      ["1", 1, true].includes(search["preview"] as string | number | boolean)
    )
      return { session: "", mode: "test", preview: true };
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
  if (search.preview && Preview)
    return (
      <Suspense>
        <Preview />
      </Suspense>
    );
  return <CheckoutPage session={search.session} mode={search.mode} />;
}
