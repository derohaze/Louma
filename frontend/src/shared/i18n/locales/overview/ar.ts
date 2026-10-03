import en from "./en";
import type { Strings } from "@/shared/i18n/types";

const ar: Strings<typeof en> = {
  title: "نظرة عامة",
  description: "الرصيد والنشاط في لمحة، مع رابط إلى كل أقسام محفظة لوما.",
  periods: {
    last7: "آخر 7 أيام",
    last30: "آخر 30 يومًا",
    last90: "آخر 90 يومًا",
  },
  periodLabel: "الفترة",
  statistics: "الإحصائيات",
  expenses: "المصروفات",
  incomes: "الإيرادات",
  chartAria: "الأموال الداخلة والخارجة خلال الفترة",
  balance: {
    show: "إظهار الرصيد",
    hide: "إخفاء الرصيد",
    available: "الرصيد المتاح",
    ready: "جاهز للتحويل",
    frozen: "مُجمَّد · التحويلات مرفوضة",
  },
  mining: {
    cardAria: "دورة التعدين",
    progress: "دورة تعدين #{number} · {rate} LMA/س",
    none: "لا توجد دورة نشطة · ابدأ واحدة لتكسب",
    completed: "{percent}% مكتمل",
    remaining: "متبقٍ {time}",
  },
  transfers: {
    label: "التحويلات · {period}",
    empty: "لا توجد حركة في هذه الفترة بعد.",
  },
  relative: {
    today: "اليوم",
    yesterday: "أمس",
    daysAgo: "قبل {days} أيام",
  },
  quickSend: {
    label: "أرسل أموالًا إلى",
    newTransfer: "تحويل جديد",
    none: "لا يوجد مستلمون بعد.",
    receive: "[ استلام ]",
    transfer: "[ تحويل ]",
  },
  mined: {
    label: "مُعدَّن · {count} {unit}",
    lastCollected: "آخر تحصيل {time}",
    nothingCollected: "لم يُحصَّل أي شيء بعد",
  },
  account: {
    label: "الحساب",
    twoFactor: "التحقق بخطوتين",
    sessions: "الجلسات",
    wallet: "المحفظة",
    securityCenter: "مركز الأمان",
  },
};

export default ar;
