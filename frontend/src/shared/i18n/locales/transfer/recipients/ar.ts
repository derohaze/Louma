import en from "./en";
import type { Strings } from "@/shared/i18n/types";

const ar: Strings<typeof en> = {
  title: "المستلمون",
  description: "كل من دفعت له هذه المحفظة، مع اختصار محفوظ إلى نموذج التحويل.",
  saved: "المحفوظون",
  recent: "الأحدث",
  recentNote: "دُفع لهم سابقًا بدون حفظ. احفظ أحدهم لتمنحه اسمًا وزرًّا سريعًا.",
  lastPaid: "آخر دفعة {date}",
  savedTag: " · محفوظ",
  send: "إرسال",
  saveLabel: "حفظ الاسم",
  remove: "إزالة العنوان",
  removeAria: "إزالة {label}",
  labelAria: "اسم لـ {address}",
  labelPlaceholder: "اسم (اختياري)",
  empty: "لا توجد تحويلات صادرة بعد. ستظهر العناوين التي دفعت لها هنا لإعادة الإرسال بلمسة.",
};

export default ar;
