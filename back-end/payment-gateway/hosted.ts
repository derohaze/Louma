import { readFile } from "node:fs/promises";
import type { Payment } from "./domain/models.js";
import { formatMoney } from "./domain/money.js";
import type { GatewayConfig } from "./config.js";
type Data = Record<string, string | boolean>;
type Node =
  | {
      text: string;
    }
  | {
      field: string;
    }
  | {
      condition: string[];
      yes: Node[];
      no: Node[];
    };
function compile(source: string): Node[] {
  const root: Node[] = [];
  let current = root;
  const stack: {
    parent: Node[];
    node: Extract<
      Node,
      {
        condition: string[];
      }
    >;
  }[] = [];
  for (const part of source.split(/(\{\{[^}]+\}\})/)) {
    if (!part.startsWith("{{")) {
      current.push({ text: part });
      continue;
    }
    const token = part.slice(2, -2).trim();
    if (token.startsWith("if ")) {
      const condition = token
        .slice(3)
        .replace(/^and /, "")
        .split(" ")
        .map((v) => v.slice(1));
      const node = { condition, yes: [] as Node[], no: [] as Node[] };
      current.push(node);
      stack.push({ parent: current, node });
      current = node.yes;
    } else if (token === "else") {
      const frame = stack.at(-1);
      if (!frame) throw new Error("Invalid checkout template");
      current = frame.node.no;
    } else if (token === "end") {
      const frame = stack.pop();
      if (!frame) throw new Error("Invalid checkout template");
      current = frame.parent;
    } else if (/^\.[A-Za-z]+$/.test(token))
      current.push({ field: token.slice(1) });
    else throw new Error("Unsupported checkout template expression");
  }
  if (stack.length) throw new Error("Unclosed checkout template");
  return root;
}
const template = compile(
  await readFile(new URL("./web/checkout/page.html", import.meta.url), "utf8"),
);
export const logo = await readFile(
  new URL("./web/checkout/logo.png", import.meta.url),
);
const escape = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
function render(nodes: Node[], data: Data): string {
  return nodes
    .map((node) =>
      "text" in node
        ? node.text
        : "field" in node
          ? escape(String(data[node.field] ?? ""))
          : render(
              node.condition.every((key) => !!data[key]) ? node.yes : node.no,
              data,
            ),
    )
    .join("");
}
export function hostedCheckout(
  p: Payment,
  config: GatewayConfig,
  arabic: boolean,
): string {
  const state =
    p.status === "requires_action" && p.expiresAt.getTime() <= Date.now()
      ? "expired"
      : p.status;
  const messages: Record<string, [string, string]> = arabic
    ? {
        succeeded: [
          "تم الدفع بنجاح",
          "استلم التاجر المبلغ. يمكنك العودة إلى موقعه.",
        ],
        requires_action: ["بانتظار تأكيدك", ""],
        expired: ["انتهت صلاحية الدفع", "اطلب رابط دفع جديدًا من التاجر."],
        canceled: ["تم إلغاء الدفع", "اطلب رابط دفع جديدًا من التاجر."],
      }
    : {
        succeeded: [
          "Payment complete",
          "Your payment has been received. You can return to the merchant.",
        ],
        requires_action: ["Awaiting your approval", ""],
        expired: [
          "Expired",
          "This checkout has expired and can no longer be paid. Contact the merchant for a new checkout.",
        ],
        canceled: [
          "Canceled",
          "This checkout was canceled. Contact the merchant for a new checkout.",
        ],
      };
  const [label, note] =
    messages[state] ??
    (arabic
      ? ["تعذر إتمام الدفع", "تواصل مع التاجر لطلب رابط جديد."]
      : [
          "Failed",
          "This payment could not be completed. Contact the merchant for a new checkout.",
        ]);
  return render(template, {
    Arabic: arabic,
    LanguageURL: `/checkout/${p.publicId}?lang=${arabic ? "en" : "ar"}`,
    IntervalLabel: arabic
      ? p.interval === "year"
        ? "سنويًا"
        : "شهريًا"
      : p.interval === "year"
        ? "Yearly"
        : "Monthly",
    Succeeded: state === "succeeded",
    Sandbox: config.environment === "test",
    Merchant: p.merchantName,
    Description: p.description,
    Total: formatMoney(p.totalMinor),
    Subtotal: formatMoney(p.subtotalMinor),
    Tax: formatMoney(p.taxMinor),
    Recurring: p.interval,
    StatusLabel: label,
    InactiveNote: note,
    Reference: p.publicId,
    Payable: state === "requires_action",
    Continue: `${config.dashboardUrl}/checkout?session=${encodeURIComponent(p.publicId)}&mode=${config.environment}`,
  });
}
