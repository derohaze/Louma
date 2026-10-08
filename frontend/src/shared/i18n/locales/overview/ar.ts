import en from "./en";
import type { Strings } from "@/shared/i18n/types";

const ar: Strings<typeof en> = {
  title: "نظرة عامة",
  description: "الرصيد والنشاط في لمحة، مع رابط إلى كل أقسام محفظة لوما.",
  periods: {
    last1: "آخر 24 ساعة",
    last7: "آخر 7 أيام",
    last30: "آخر 30 يومًا",
    last90: "آخر 90 يومًا",
    last120: "آخر 120 يومًا",
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
    frozen: "المحفظة مجمّدة. لن تُقبل التحويلات.",
    unavailable: "الرصيد غير متاح",
    addressUnavailable: "عنوان المحفظة غير متاح",
  },
  mining: {
    cardAria: "دورة التعدين",
    progress: "دورة التعدين رقم {number}. المعدل {rate} LMA في الساعة",
    ofTotal: "من",
    noneTitle: "لا توجد دورة نشطة",
    none: "ابدأ دورة تعدين لتحصل على المكافآت.",
    unavailableTitle: "بيانات الدورة غير متاحة",
    unavailableDetail: "افتح صفحة التعدين لمراجعة الحالة الحالية.",
    completed: "اكتمل {percent} بالمئة",
    remaining: "متبقٍ {time}",
  },
  transfers: {
    label: "التحويلات خلال {period}",
    empty: "لا توجد تحويلات مسجلة خلال هذه الفترة.",
  },
  relative: {
    today: "اليوم",
    yesterday: "أمس",
    daysAgo: "قبل {days} أيام",
  },
  quickSend: {
    label: "أرسل أموالًا إلى",
    newTransfer: "تحويل جديد",
    none: "لا يوجد مستلمون متاحون حتى الآن.",
    receive: "استلام الأموال",
    transfer: "تحويل الأموال",
  },
  mined: {
    label: "مكافآت التعدين · {period} · {count} {unit}",
    lastCollected: "آخر تحصيل {time}",
    nothingCollected: "لم يتم تحصيل أي مكافآت تعدين حتى الآن.",
  },
  account: {
    label: "الحساب",
    twoFactor: "التحقق بخطوتين",
    sessions: "الجلسات",
    wallet: "المحفظة",
    securityCenter: "مركز الأمان",
    unavailable: "غير متاح",
  },
};

export default ar;
