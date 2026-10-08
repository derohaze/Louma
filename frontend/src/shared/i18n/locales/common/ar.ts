import en from "./en";
import type { Strings } from "@/shared/i18n/types";

const ar: Strings<typeof en> = {
  actions: {
    save: "حفظ",
    saving: "جارٍ الحفظ…",
    loading: "جارٍ التحميل…",
    cancel: "إلغاء",
    continue: "متابعة",
    back: "رجوع",
    close: "إغلاق",
    refresh: "تحديث",
    retry: "إعادة المحاولة",
    copy: "نسخ",
    copied: "تم النسخ",
    copyAddress: "نسخ العنوان",
    dismiss: "إغلاق",
  },
  loading: {
    page: "جارٍ تحميل {title}…",
    pending: "جارٍ الانتظار…",
  },
  errors: {
    requestFailed: "تعذّر إتمام الطلب.",
    requestFailedRetry: "تعذّر إتمام الطلب. حاول مرة أخرى.",
  },
  state: {
    pro: "Pro",
    free: "مجاني",
    on: "مفعّل",
    off: "متوقف",
    active: "نشِط",
    frozen: "مُجمّد",
    notSet: "غير محدد",
    none: "—",
    completed: "تم",
    refused: "تم رفض الطلب",
  },
  /** Which way money moved, beside an amount. */
  direction: {
    sent: "صادر",
    received: "وارد",
  },
  units: {
    deviceOne: "جهاز",
    deviceOther: "أجهزة",
    sessionOne: "جلسة",
    sessionOther: "جلسات",
    cycleOne: "دورة",
    cycleOther: "دورات",
    transferOne: "تحويل",
    transferOther: "تحويلات",
  },
};

export default ar;
