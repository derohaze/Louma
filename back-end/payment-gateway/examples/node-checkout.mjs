// Minimal merchant backend (Node 20+): create a checkout, then verify settlement.
// Run: LOUMA_API_KEY=lma_test_... LOUMA_BASE_URL=http://localhost:8000 node node-checkout.mjs
import { randomUUID } from "node:crypto";
import { LoumaClient } from "../sdk/javascript/index.js";

const client = new LoumaClient({
  apiKey: process.env.LOUMA_API_KEY ?? "",
  baseURL: process.env.LOUMA_BASE_URL ?? "http://localhost:8000",
});

const checkout = await client.createCheckout(
  {
    subtotal: "100.0000",
    tax: "0.0000",
    currency: "LMA",
    description: "Example order #42",
    success_url: "https://example.com/success",
    cancel_url: "https://example.com/cancel",
  },
  randomUUID(),
);
console.log("redirect buyer to:", checkout.checkout_url ?? checkout.id);

// After the buyer approves, verify against the authoritative record:
const payment = await client.retrievePayment(checkout.payment_id ?? checkout.id);
if (payment.status === "succeeded") console.log("settled:", payment.transaction_reference);
else console.log("not settled yet:", payment.status);
