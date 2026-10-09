import { useState } from "react";
import { useT } from "@/shared/i18n";
import { CopyButton } from "@/shared/ui/page";
import { Panel } from "@/shared/ui/panels";
import { DeveloperScopeGate, useDeveloperScope } from "./DeveloperScope";

const languages = ["python", "node"] as const;
type Language = (typeof languages)[number];
const labels: Record<Language, string> = {
  node: "Node.js",
  python: "Python",
};

const samples = (base: string, prefix: string): Record<Language, string> => ({
  node: `// Merchant server, Node 20+. Client: payment-gateway/sdk/javascript.
import { LoumaClient } from './sdk/javascript/index.js';

const client = new LoumaClient({
  apiKey: process.env.LOUMA_API_KEY,   // ${prefix}…
  baseURL: '${base}',
});

// Persist the key with the order and reuse it after an uncertain timeout.
const checkout = await client.createCheckout(
  { subtotal: '10.0000', tax: '0.0000', currency: 'LMA', description: 'Order 42' },
  order.idempotencyKey,
);
res.redirect(checkout.checkout_url);

// Fulfil on the authoritative payment, never on the success redirect.
const payment = await client.retrievePayment(checkout.payment_id ?? checkout.id);
if (payment.status === 'succeeded') await fulfil(order, payment.transaction_reference);`,
  python: `# Merchant server, Python 3.10+. Client: payment-gateway/sdk/python (standard library only).
import os
from louma_payments import LoumaClient

client = LoumaClient(os.environ['LOUMA_API_KEY'], '${base}')   # ${prefix}…

checkout = client.create_checkout(
    dict(subtotal='10.0000', tax='0.0000', currency='LMA', description='Order 42'),
    order.idempotency_key,
)
redirect(checkout['checkout_url'])

payment = client.retrieve_payment(checkout['payment_id'])
if payment['status'] == 'succeeded':
    fulfil(order, payment['transaction_reference'])`,
});

/** Local gateway origin the samples start from; merchants replace it with their own origin. */
const LOCAL_GATEWAY = "http://localhost:8090";

export function DeveloperExamplesPage() {
  const t = useT("developer");
  const scope = useDeveloperScope();
  const [language, setLanguage] = useState<Language>("python");
  const [base, setBase] = useState(LOCAL_GATEWAY);
  return (
    <DeveloperScopeGate
      scope={scope}
      title={t("examplesPage.title")}
      description={t("examplesPage.description")}
    >
      {(ready) => {
        const code = samples(
          base.trim().replace(/\/+$/, "") || LOCAL_GATEWAY,
          ready.mode === "test" ? "lma_test_" : "lma_live_",
        )[language];
        return (
          <div className="space-y-5">
            <Panel title={t("examplesPage.baseUrl")} description={t("examplesPage.baseUrlHint")}>
              <input
                value={base}
                onChange={(event) => setBase(event.target.value)}
                dir="ltr"
                spellCheck={false}
                maxLength={2048}
                className="h-11 w-full max-w-md rounded-xl border bg-card px-4 text-sm"
                aria-label={t("examplesPage.baseUrl")}
              />
              <p className="mt-3 text-xs text-muted-foreground">{t("examplesPage.keyHint")}</p>
            </Panel>
            <div
              role="tablist"
              aria-label={t("examplesPage.language")}
              className="flex flex-wrap gap-2"
            >
              {languages.map((entry) => (
                <button
                  key={entry}
                  type="button"
                  role="tab"
                  aria-selected={language === entry}
                  onClick={() => setLanguage(entry)}
                  className={`min-h-10 rounded-full border px-4 text-sm font-medium ${language === entry ? "border-primary bg-primary text-primary-foreground" : "bg-card text-muted-foreground hover:text-foreground"}`}
                >
                  {labels[entry]}
                </button>
              ))}
            </div>
            <Panel title={labels[language]} action={<CopyButton text={code} />}>
              <pre
                dir="ltr"
                className="overflow-x-auto rounded-xl bg-secondary p-4 text-xs leading-6"
              >
                <code>{code}</code>
              </pre>
            </Panel>
            <Panel title={t("examplesPage.rulesTitle")}>
              <div className="grid gap-3 sm:grid-cols-2">
                {(["serverOnly", "idempotency", "fulfilment", "access"] as const).map((rule) => (
                  <p key={rule} className="rounded-xl border bg-card px-4 py-3 text-sm leading-6">
                    {t(`examplesPage.rules.${rule}`)}
                  </p>
                ))}
              </div>
            </Panel>
          </div>
        );
      }}
    </DeveloperScopeGate>
  );
}
