import en from "./en";
import type { Strings } from "@/shared/i18n/types";

const ar: Strings<typeof en> = {
  title: "تحويل",
  description: "أرسل LMA إلى عنوان محفظة آخر.",
  frozenNotice: "المحفظة مجمّدة، لذا سيُرفض كل تحويل.",
  unfreeze: "ارفع التجميد",
  availableBalance: "الرصيد المتاح",
  taxNote: "تُخصم ضريبة الشبكة (1%) مما يدفعه المرسل، ويستلم المستلم الباقي.",
  credential: {
    required: "مطلوب إثبات هوية",
    none: "لا يوجد إثبات محدد",
    accepts: "تقبل هذه المحفظة {methods} قبل خروج أي LMA منها.",
    methodsBoth: "كلمة مرور التحويل أو رمز المصادقة",
    methodsPassword: "كلمة مرور التحويل",
    methodsCode: "رمز المصادقة",
    without: "بدون كلمة مرور تحويل أو تطبيق مصادقة، تستطيع جلسة مسجّلة الدخول تحريك الأموال وحدها.",
    setUp: "إعداد إثبات هوية",
    final: "التحويلات نهائية بعد الإرسال. لا يتحرك أي شيء قبل الخطوة الأخيرة.",
  },
};

export default ar;
