import en from "./en";
import type { Strings } from "@/shared/i18n/types";

const ar: Strings<typeof en> = {
  title: "التحليلات",
  description: "إلى أين يذهب المال: التدفق والأطراف والتعدين على مدى الوقت.",
  historyLoading: "جارٍ تحميل إحصاءات التحويلات…",
  historyError: "إحصاءات التحويلات غير متاحة الآن.",
  retry: "إعادة المحاولة",
  range: {
    label: "المدة الزمنية",
    days: "{days} يوم",
    last1: "آخر 24 ساعة",
    last7: "آخر 7 أيام",
    last30: "آخر 30 يومًا",
    last90: "آخر 90 يومًا",
    last120: "آخر 120 يومًا",
  },
  flow: {
    title: "التدفق",
    subtitle: "الأموال الداخلة مقابل الخارجة · {range}",
    chartAria: "الأموال الداخلة والخارجة خلال المدة المختارة",
    income: "الإيرادات",
    expenses: "المصروفات",
    peak: "الذروة {amount} LMA / فترة",
  },
  tooltip: {
    in: "داخل",
    out: "خارج",
    mined: "تعدين",
  },
  totals: {
    income: "الإيرادات",
    incomeDetail: "LMA مستلَم · {range}",
    expenses: "المصروفات",
    expensesDetail: "LMA مُرسَل · {range}",
    transfers: "التحويلات",
    net: "الصافي {amount} LMA",
    mined: "التعدين",
    cycleOne: "دورة واحدة محصّلة",
    cycles: "{count} دورات محصّلة",
  },
  counterparties: {
    title: "أكثر الأطراف تعاملًا",
    subtitle: "حسب الحجم · {range}",
    received: "مستلَم",
    sent: "مُرسَل",
    empty: "لم يتحرك أي مبلغ في هذه المدة بعد.",
  },
  mining: {
    title: "التعدين خلال المدة",
    subtitle: "التعدين المحصّل مقابل التحويلات · {range}",
    moved: "حركة التحويلات",
    collected: "التعدين المحصّل",
    open: "فتح التعدين",
  },
};

export default ar;
