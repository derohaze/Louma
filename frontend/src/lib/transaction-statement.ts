import { currency, dateText, transferNet, transferTax } from "@/lib/wallet-format";
import { transactionStatus, type Transaction } from "@/lib/demo-wallet";

const ROWS_PER_PAGE = 14;

/**
 * What one stored transaction means to each side of the transfer. The wallet records the amount of
 * the transfer; the 1% network tax is deducted from what the recipient receives, so an outgoing row
 * shows the debited amount, the tax, and the smaller figure that landed.
 */
const rowFacts = (row: Transaction) => {
  const tax = transferTax(row.amount);
  return row.direction === "sent"
    ? { tax, net: transferNet(row.amount), netLabel: "Recipient received" }
    : { tax, net: row.amount, netLabel: "Credited to this wallet" };
};

/** PDF statement for a list of transactions, also used as the single-transfer receipt. */
export function exportTransactions(rows: Transaction[], name = "wallet-history") {
  void import("jspdf").then(({ jsPDF }) => {
    const pdf = new jsPDF();
    pdf.setFontSize(16);
    pdf.text("Louma Wallet — Transaction Statement", 14, 20);
    pdf.setFontSize(10);
    pdf.text(`Generated ${new Date().toLocaleString()}`, 14, 29);
    pdf.text(
      `${rows.length} transaction${rows.length === 1 ? "" : "s"} · network tax 1% on every transfer`,
      14,
      35,
    );
    let y = 48;
    rows.forEach((row, index) => {
      if (index && index % ROWS_PER_PAGE === 0) {
        pdf.addPage();
        y = 20;
      }
      const facts = rowFacts(row);
      pdf.setTextColor(0);
      pdf.text(
        `${dateText(row.created_at)}  ${row.direction.toUpperCase()}  ${currency(row.amount)}  (${transactionStatus(row)})`,
        14,
        y,
      );
      pdf.setTextColor(100);
      pdf.text(`${row.transfer_id} · ${row.counterparty_address.slice(0, 34)}`, 14, y + 5);
      pdf.text(
        `Tax 1% ${currency(facts.tax)} · ${facts.netLabel} ${currency(facts.net)}${
          row.note ? ` · ${row.note.slice(0, 30)}` : ""
        }${row.recipient_rating ? ` · rated ${row.recipient_rating}/5` : ""}`,
        14,
        y + 10,
      );
      pdf.setTextColor(0);
      y += 18;
    });
    pdf.save(`${name}.pdf`);
  });
}

const csvCell = (value: string | number) => `"${String(value).replace(/"/g, '""')}"`;

/**
 * Spreadsheet export of the same rows. Amounts are written as plain numbers so the file can be
 * summed in a spreadsheet, with the currency named once in the header.
 */
export function exportTransactionsCsv(rows: Transaction[], name = "wallet-history") {
  const header = [
    "Date",
    "Transfer ID",
    "Direction",
    "Counterparty",
    "Amount (LMA)",
    "Tax 1% (LMA)",
    "Net (LMA)",
    "Note",
    "Recipient rating",
    "Status",
  ];
  const body = rows.map((row) => {
    const facts = rowFacts(row);
    return [
      new Date(row.created_at).toISOString(),
      row.transfer_id,
      row.direction,
      row.counterparty_address,
      row.amount.toFixed(2),
      facts.tax.toFixed(2),
      facts.net.toFixed(2),
      row.note,
      row.recipient_rating ? `${row.recipient_rating}/5` : "",
      transactionStatus(row),
    ];
  });
  const csv = [header, ...body].map((line) => line.map(csvCell).join(",")).join("\r\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `${name}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}
