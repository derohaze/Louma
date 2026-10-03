import en from "./en";
import type { Strings } from "@/shared/i18n/types";

const ar: Strings<typeof en> = {
  set: {
    title: "كلمة مرور التحويل مُعدّة",
    body: "كل تحويل يطلبها قبل خروج أي LMA من المحفظة.",
    action: "تغيير كلمة مرور التحويل",
    submit: "تحديث كلمة المرور",
  },
  unset: {
    title: "لا توجد كلمة مرور تحويل",
    body: "من دونها تستطيع أي جلسة مسجّلة الدخول تحريك الأموال بنفسها.",
    action: "إعداد كلمة مرور التحويل",
    submit: "حفظ كلمة المرور",
  },
  description: "منفصلة عن كلمة مرور المحفظة، حتى لا تُحرّك الأموال إذا تسرّبت جلسة دخول.",
  current: "كلمة مرور التحويل الحالية",
  next: "كلمة مرور التحويل الجديدة",
  nextHint: "8 أحرف على الأقل",
  repeat: "أعد كتابة كلمة مرور التحويل الجديدة",
  rules: {
    title: "متى تُطلب",
    description: "القواعد التي تتبعها المحفظة في كل تحويل.",
    everyTransfer: "كل تحويل",
    required: "كلمة المرور هذه مطلوبة",
    notRequired: "غير مطلوبة",
    wrongPassword: "كلمة مرور خاطئة",
    wrongPasswordDetail: "يُرفض التحويل قبل خروج أي LMA من المحفظة",
  },
  errors: {
    currentRequired: "أدخل كلمة مرور التحويل الحالية.",
  },
  messages: {
    saved: "تم تحديث كلمة مرور التحويل.",
  },
};

export default ar;
