import { currency, dateText } from "@/lib/wallet-format";
import type { Transaction } from "@/lib/demo-wallet";

const ROWS_PER_PAGE = 18;

export function exportTransactions(rows: Transaction[], name = "wallet-history") {
  void import("jspdf").then(({ jsPDF }) => {
    const pdf = new jsPDF();
    pdf.setFontSize(16);
    pdf.text("WLT Wallet — Transaction Statement", 14, 20);
    pdf.setFontSize(10);
    pdf.text(`Generated ${new Date().toLocaleString()}`, 14, 29);
    rows.forEach((row, index) => {
      const y = 42 + (index % ROWS_PER_PAGE) * 12;
      if (index && index % ROWS_PER_PAGE === 0) pdf.addPage();
      pdf.text(
        `${dateText(row.created_at)}  ${row.direction.toUpperCase()}  ${currency(row.amount)}`,
        14,
        y,
      );
      pdf.setTextColor(100);
      pdf.text(row.counterparty_address.slice(0, 42), 14, y + 5);
      pdf.setTextColor(0);
    });
    pdf.save(`${name}.pdf`);
  });
}
