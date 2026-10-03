import en from "./en";
import type { Strings } from "@/shared/i18n/types";

const ar: Strings<typeof en> = {
  amount: {
    empty: "أدخل مبلغًا.",
    invalid: "أدخل مبلغًا موجبًا، بحد أقصى أربع خانات عشرية.",
    zero: "أدخل مبلغًا أكبر من صفر.",
    tooSmall: "هذا المبلغ أصغر من أن يُرسَل.",
    tooLarge: "هذا المبلغ أكبر من المتاح للإرسال.",
  },
  password: {
    minLength: "{min} أحرف على الأقل",
    letter: "يحتوي على حرف",
    number: "يحتوي على رقم",
    tooLong: "استخدم {max} حرفًا على الأكثر.",
    weak: "استخدم {min} أحرف على الأقل مع حروف وأرقام.",
    mismatch: "كلمتا المرور غير متطابقتين.",
  },
};

export default ar;
