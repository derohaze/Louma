import en from "./en";
import type { Strings } from "@/shared/i18n/types";

const ar: Strings<typeof en> = {
  title: "الحركات",
  kinds: {
    transfer: "تحويل",
    merchant_payment: "دفع للتاجر",
    merchant_refund: "استرداد من التاجر",
  },
  description: "ابحث في حركاتك وصفّها.",
  exportShown: "تصدير المعروض ({count})",
  searchAria: "بحث في الحركات",
  searchPlaceholder: "ابحث بعنوان أو ملاحظة أو معرّف تحويل",
  filters: {
    all: "الكل",
    sent: "صادر",
    received: "وارد",
  },
  advanced: {
    label: "خيارات متقدمة",
    on: "خيارات متقدمة · مفعّلة",
  },
  fields: {
    fromDate: "من تاريخ",
    toDate: "إلى تاريخ",
    minAmount: "أقل مبلغ (LMA)",
    maxAmount: "أعلى مبلغ (LMA)",
  },
  amountsError: "يجب أن تكون المبالغ أرقامًا موجبة بأربع خانات عشرية على الأكثر.",
  stats: {
    loaded: "الحركات المحمّلة",
    sent: "صادر",
    received: "وارد",
    tax: "رسوم المعالجة المدفوعة",
  },
  listHeading: "الحركات · {count} معروضة",
  empty: {
    noMatchTitle: "لا توجد حركات مطابقة",
    noMatchDetail: "جرّب بحثًا أو تصفية أخرى.",
    clear: "مسح التصفية",
    noneTitle: "لا توجد حركات بعد",
    noneDetail: "أرسل أو استلم LMA لتظهر حركاتك هنا.",
    transfer: "تحويل",
  },
  loadOlder: "تحميل حركات أقدم",
  loading: "جارٍ التحميل…",
  previous: "السابق",
  next: "التالي",
};

export default ar;
