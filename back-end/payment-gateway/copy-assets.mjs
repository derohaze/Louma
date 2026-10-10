import { cp, mkdir } from "node:fs/promises";
const destination = new URL("../dist/payment-gateway/web/checkout/", import.meta.url);
await mkdir(destination, { recursive: true });
await cp(new URL("./web/checkout/", import.meta.url), destination, { recursive: true });
