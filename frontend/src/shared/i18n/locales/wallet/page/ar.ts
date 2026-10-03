import en from "./en";
import type { Strings } from "@/shared/i18n/types";

const ar: Strings<typeof en> = {
  title: "المحفظة",
  description: "رصيد محفظتك وعنوان الاستلام.",
  transfer: "تحويل",
  primaryAddress: "العنوان الأساسي",
  qrAria: "رمز QR لعنوان الاستلام",
  flow: {
    title: "الرصيد والتدفق",
    subtitle: "الأموال الداخلة مقابل الخارجة",
    chartAria: "الأموال الداخلة والخارجة خلال آخر 30 يومًا",
  },
  growth: {
    title: "نمو الحجم",
    prev: "(السابق {amount})",
    summary: "تحرّكت {count} {unit} بقيمة {volume} LMA خلال آخر {days} يومًا.",
  },
  income: {
    title: "نسبة الإيرادات",
    note: "نسبة التدفق الداخل · آخر {days} يومًا",
  },
  breakdown: {
    title: "تفصيل التدفق",
    subtitle: "أين تتمركز الأموال · آخر {days} يومًا",
    mined: "مُعدَّن",
  },
  totals: {
    transfers: "التحويلات · آخر {days} يومًا",
    vsPrev: "{arrow} {percent}% مقابل السابق ({count})",
    movedOut: "من إجمالي حجم {total}",
  },
};

export default ar;
