import en from "./en";
import type { Strings } from "@/shared/i18n/types";

const ar: Strings<typeof en> = {
  title: "سجل التعدين",
  description: "كل دورات التعدين السابقة بمعدلها وأرباحها والمكافآت المحصّلة.",
  heading: "سجل الدورات",
  headingNote: "دورات التعدين ومكافآتها خلال الفترة المختارة",
  range: {
    label: "مدة السجل",
    last1: "آخر 24 ساعة",
    last7: "آخر 7 أيام",
    last30: "آخر 30 يومًا",
    last90: "آخر 90 يومًا",
    last120: "آخر 120 يومًا",
  },
  loading: "جارٍ تحميل الدورات…",
  empty: {
    title: "لا توجد دورات بعد",
    detail: "ابدأ دورتك الأولى من الأعلى — ستُسجَّل هنا بعد انتهائها.",
  },
  stats: {
    collected: "المحصَّل",
    cycles: "الدورات",
    averageRate: "متوسط المعدل",
  },
  status: {
    active: "جارٍ",
    completed: "جاهزة للتحصيل",
    settled: "محصَّلة",
  },
  cycle: "الدورة #{number}",
  cycleMeta: "{rate} LMA/س · انتهت {date}",
  earned: "مكتسب {amount}",
  loadOlder: "تحميل دورات أقدم",
};

export default ar;
