import en from "./en";
import type { Strings } from "@/shared/i18n/types";

const ar: Strings<typeof en> = {
  fields: {
    email: "البريد الإلكتروني",
    password: "كلمة المرور",
    fullName: "الاسم الكامل",
    code: "رمز المصادقة أو رمز الاسترجاع",
  },
  showPassword: "إظهار كلمة المرور",
  hidePassword: "إخفاء كلمة المرور",
  logoAlt: "شعار لوما",
  session: {
    checking: "جارٍ التحقق من جلستك…",
  },
  login: {
    title: "أهلًا بعودتك",
    subtitle: "سجّل الدخول إلى محفظة لوما.",
    description: "سجّل الدخول إلى محفظة لوما.",
    footerQuestion: "جديد على لوما؟",
    footerAction: "أنشئ حسابًا",
    submit: "تسجيل الدخول",
    verify: "تحقق من الرمز",
    busy: "جارٍ تسجيل الدخول…",
    forgot: "نسيت كلمة المرور؟",
  },
  signup: {
    title: "ابدأ رحلتك مع المحفظة",
    subtitle: "أنشئ حساب لوما في ثوانٍ.",
    description: "أنشئ حساب لوما في ثوانٍ.",
    footerQuestion: "لديك حساب بالفعل؟",
    footerAction: "تسجيل الدخول",
    submit: "ابدأ",
    busy: "جارٍ إنشاء الحساب…",
  },
  forgot: {
    title: "إعادة تعيين كلمة المرور",
    subtitle: "أدخل بريدك الإلكتروني وسنرسل إليك رابط إعادة التعيين.",
    description: "أدخل بريدك الإلكتروني وسنرسل إليك رابط إعادة التعيين.",
    footerQuestion: "تذكرتها؟",
    footerAction: "العودة لتسجيل الدخول",
    submit: "إرسال رابط إعادة التعيين",
    busy: "جارٍ الإرسال…",
    sentTitle: "تحقق من بريدك",
    sentBody: "إذا كان هناك حساب مرتبط بـ {email}، فرابط إعادة التعيين في طريقه إليك.",
    back: "العودة لتسجيل الدخول",
  },
};

export default ar;
