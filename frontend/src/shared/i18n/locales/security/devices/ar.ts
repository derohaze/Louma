import en from "./en";
import type { Strings } from "@/shared/i18n/types";

const ar: Strings<typeof en> = {
  panel: {
    title: "الأجهزة المسجّلة الدخول",
    description: "إنهاء جهاز يُنهي جلسته عند أول طلب بعده.",
  },
  signOutOthers: "تسجيل الخروج من الأجهزة الأخرى",
  confirm: {
    title: "تسجيل الخروج من {count} جهاز آخر؟",
    body: "تبقى جلستهم حتى أول طلب بعد ذلك، حينها يحتاجون إلى بيانات دخولك وعامل ثانٍ مرة أخرى. هذا الجهاز غير متأثر.",
    action: "تسجيل خروجهم",
  },
  loading: "جارٍ تحميل الأجهزة…",
  lastActive: "آخر نشاط {lastActive} · تنتهي {expires}",
  thisDevice: "هذا الجهاز",
  currentSession: "الجلسة الحالية",
  signOut: "تسجيل الخروج",
  empty: "لا توجد جلسات نشطة.",
  messages: {
    revoked: "تم تسجيل خروج {device}.",
    revokedOthers: "تم تسجيل الخروج من {count} جلسة أخرى.",
  },
  lostDevice: {
    question: "فقدت جهازًا؟",
    freeze: "جمّد المحفظة",
    tail: "أولًا، ثم أنهِ الجلسة.",
  },
};

export default ar;
