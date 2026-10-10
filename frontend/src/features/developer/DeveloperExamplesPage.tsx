import { useState } from "react";
import { ArrowUpRight, Code2, LockKeyhole } from "lucide-react";
import { useT } from "@/shared/i18n";
import { CopyButton } from "@/shared/ui/page";
import { Panel } from "@/shared/ui/panels";
import { DeveloperScopeGate, useDeveloperScope } from "./DeveloperScope";

const samples = (base: string, amount: string) => ({
  node: `// Node.js 20+ · on your server. No SDK required.
const base = ${JSON.stringify(base)};
const headers = {
  Authorization: \`Bearer \${process.env.LOUMA_API_KEY}\`,
  'Content-Type': 'application/json',
};

// Call from your authenticated POST /orders/:id/pay handler.
// Load order for the signed-in customer from YOUR database.
// Persist order.paymentKey once; reuse it if a request times out.
export async function createPayment(order) {
  const response = await fetch(base + '/v1/checkouts', {
    method: 'POST',
    headers: { ...headers, 'Idempotency-Key': order.paymentKey },
    body: JSON.stringify({
      subtotal: '${amount}', // Set on your server, or use order.priceLma.
      currency: 'LMA',
      description: 'Order ' + order.id,
      metadata: { order_id: String(order.id) },
    }),
  });
  if (!response.ok) throw new Error('Checkout failed: ' + response.status);
  const payment = await response.json();
  // Save payment.payment_id with the order, then redirect:
  // res.redirect(303, payment.checkout_url);
  return payment;
}

// Call from your server's order-status handler or background check.
export async function isPaid(order) {
  const response = await fetch(base + '/v1/payments/' + encodeURIComponent(order.paymentId), { headers });
  if (!response.ok) throw new Error('Payment check failed');
  const payment = await response.json();
  return payment.status === 'succeeded'
    && payment.metadata.order_id === String(order.id)
    && payment.total === order.totalLma // Persist as four decimals: '${amount}'.
    && payment.currency === 'LMA';
}
// Fulfil once only, in your database transaction, after isPaid(order).
// A redirect or a message from the browser is never proof of payment.`,
  python: `# Python 3.10+ · on your server. Standard library only.
import json, os
from urllib.request import Request, urlopen
from urllib.parse import quote

BASE = ${JSON.stringify(base)}

def call(path, payload=None, key=None):
    headers = {'Authorization': 'Bearer ' + os.environ['LOUMA_API_KEY']}
    if key:
        headers['Idempotency-Key'] = key
    data = None
    if payload is not None:
        headers['Content-Type'] = 'application/json'
        data = json.dumps(payload).encode()
    with urlopen(Request(BASE + path, data=data, headers=headers), timeout=15) as response:
        return json.load(response)

# In your authenticated POST /orders/:id/pay handler, load the order
# for the signed-in customer. Persist payment_key once for retries.
def create_payment(order):
    payment = call('/v1/checkouts', {
        'subtotal': '${amount}', # Server price; never take it from the browser.
        'currency': 'LMA',
        'description': 'Order ' + str(order['id']),
        'metadata': {'order_id': str(order['id'])},
    }, order['payment_key'])
    # Save payment['payment_id'] with the order, then redirect (303)
    # to payment['checkout_url'] using your web framework.
    return payment

def is_paid(order):
    payment = call('/v1/payments/' + quote(order['payment_id'], safe=''))
    return (payment['status'] == 'succeeded'
            and payment['metadata']['order_id'] == str(order['id'])
            and payment['total'] == order['total_lma'] # Four decimals: '${amount}'.
            and payment['currency'] == 'LMA')

# Fulfil once in your database after is_paid(order). Never trust a redirect.`,
});

export function DeveloperExamplesPage() {
  const t = useT("developer");
  const scope = useDeveloperScope();
  const [language, setLanguage] = useState<"node" | "python">("node");
  const [amount, setAmount] = useState("50.0000");
  const [baseOverride, setBaseOverride] = useState("");
  const productionBase = "https://checkout.loumapay.com";
  const gatewayUrl = scope.access.data?.gateway_url;
  const base =
    baseOverride || (gatewayUrl && !gatewayUrl.includes("localhost") ? gatewayUrl : productionBase);
  const button = `<form action="/orders/42/pay" method="post">
  <!-- Render your framework's CSRF token here. -->
  <input type="hidden" name="csrf" value="{{ csrf_token }}">
  <button type="submit" style="background:#673de6;color:white;border:0;border-radius:12px;padding:14px 24px;font:600 15px system-ui;cursor:pointer">
    Pay ${amount.split(".")[0]} LMA with Louma ↗
  </button>
</form>`;
  const code = samples(base.trim().replace(/\/+$/, ""), amount)[language];
  return (
    <DeveloperScopeGate
      scope={scope}
      title={t("examplesPage.title")}
      description={t("examplesPage.description")}
    >
      {() => (
        <div className="space-y-6">
          <section className="grid overflow-hidden rounded-3xl border bg-card lg:grid-cols-[1fr_1.1fr]">
            <div className="p-6 sm:p-8">
              <Code2 className="mb-6 size-6 text-primary" />
              <h2 className="font-display text-xl font-semibold">
                {t("examplesPage.buttonTitle")}
              </h2>
              <p className="mt-3 max-w-md text-sm leading-7 text-muted-foreground">
                {t("examplesPage.buttonHint")}
              </p>
              <div className="mt-6 flex gap-2" aria-label={t("amount")}>
                {["50.0000", "100.0000"].map((price) => (
                  <button
                    type="button"
                    key={price}
                    aria-pressed={price === amount}
                    onClick={() => setAmount(price)}
                    className={`rounded-lg border px-4 py-2 text-sm ${price === amount ? "border-primary bg-primary/10 text-primary" : "text-muted-foreground"}`}
                  >
                    {price.split(".")[0]} LMA
                  </button>
                ))}
              </div>
            </div>
            <div className="flex min-h-48 flex-col items-center justify-center gap-4 border-t bg-primary/5 p-8 lg:border-s lg:border-t-0">
              <span className="text-xs text-muted-foreground">
                {t("examplesPage.buttonPreview")}
              </span>
              <span className="inline-flex items-center gap-6 rounded-xl bg-primary px-6 py-4 text-sm font-semibold text-primary-foreground shadow-lg shadow-primary/15">
                {t("examplesPage.pay", { amount: amount.split(".")[0] ?? "50" })}
                <ArrowUpRight className="size-4" />
              </span>
              <span className="text-xs text-muted-foreground">
                {t("examplesPage.customerHint")}
              </span>
            </div>
          </section>
          <Panel title={t("examplesPage.htmlTitle")} action={<CopyButton text={button} />}>
            <div className="overflow-hidden rounded-xl border border-neutral-800 bg-neutral-950">
              <div
                className="flex items-center gap-1.5 border-b border-neutral-800 px-4 py-2.5"
                aria-hidden="true"
              >
                <span className="size-2.5 rounded-full bg-red-500" />
                <span className="size-2.5 rounded-full bg-yellow-500" />
                <span className="size-2.5 rounded-full bg-green-500" />
              </div>
              <pre
                dir="ltr"
                className="overflow-x-auto p-5 font-mono text-xs leading-6 text-neutral-100"
              >
                <code>{button}</code>
              </pre>
            </div>
          </Panel>
          <Panel title={t("examplesPage.serverTitle")} description={t("examplesPage.keyHint")}>
            <div className="mb-5 flex flex-wrap items-center justify-between gap-4">
              <div className="flex gap-1 rounded-xl bg-secondary p-1">
                {(["node", "python"] as const).map((entry) => (
                  <button
                    type="button"
                    key={entry}
                    aria-pressed={language === entry}
                    onClick={() => setLanguage(entry)}
                    className={`rounded-lg px-4 py-2 text-sm ${language === entry ? "bg-card font-semibold shadow-sm" : "text-muted-foreground"}`}
                  >
                    {entry === "node" ? "Node.js" : "Python"}
                  </button>
                ))}
              </div>
              <CopyButton text={code} />
            </div>
            <label className="mb-5 block space-y-2 text-xs text-muted-foreground">
              <span>{t("examplesPage.baseUrl")}</span>
              <input
                value={base}
                onChange={(event) => setBaseOverride(event.target.value)}
                dir="ltr"
                maxLength={2048}
                className="h-11 w-full rounded-xl border bg-background px-4 font-mono text-sm text-foreground"
              />
            </label>
            <div className="overflow-hidden rounded-xl border border-neutral-800 bg-neutral-950">
              <div
                className="flex items-center gap-1.5 border-b border-neutral-800 px-4 py-2.5"
                aria-hidden="true"
              >
                <span className="size-2.5 rounded-full bg-red-500" />
                <span className="size-2.5 rounded-full bg-yellow-500" />
                <span className="size-2.5 rounded-full bg-green-500" />
                <span className="ms-2 font-mono text-[11px] text-neutral-400" dir="ltr">
                  {language === "node" ? "server.js" : "server.py"}
                </span>
              </div>
              <pre
                dir="ltr"
                className="max-h-[600px] overflow-auto p-5 font-mono text-xs leading-6 text-neutral-100"
              >
                <code>{code}</code>
              </pre>
            </div>
          </Panel>
          <div className="flex gap-3 rounded-2xl border p-5 text-sm leading-7 text-muted-foreground">
            <LockKeyhole className="mt-1 size-5 shrink-0 text-primary" />
            <p>{t("examplesPage.flowHint")}</p>
          </div>
        </div>
      )}
    </DeveloperScopeGate>
  );
}
