import en from "./en";
import type { Strings } from "@/shared/i18n/types";

const ar: Strings<typeof en> = {
  title: "إدارة الحساب",
  description: "هوية محفظتك ودورة حياة الحساب.",
  appearance: {
    title: "المظهر",
    description: "اختر شكل لوحة التحكم على هذا الجهاز.",
    darkMode: "الوضع الليلي",
    darkModeDetail: "حوّل لوحة التحكم إلى ألوان أغمق.",
  },
  identity: {
    title: "هوية المحفظة",
    description: "بيانات مرتبطة بحساب هذه المحفظة.",
    email: "البريد الإلكتروني",
    accountId: "معرّف الحساب",
    address: "عنوان المحفظة",
    status: "حالة المحفظة",
    created: "تاريخ الإنشاء",
  },
  delete: {
    title: "حذف حساب المحفظة",
    description: "يحذف المحفظة وحساباتها في السجل وسجلّها نهائيًا.",
    button: "حذف الحساب",
    confirmTitle: "حذف حساب هذه المحفظة؟",
    confirmBody: "ستُحذف المحفظة وعنوانها وكل التحويلات نهائيًا. لا يمكن التراجع عن ذلك.",
    keep: "الإبقاء على محفظتي",
    unavailable:
      "حذف الحساب غير متاح بعد. لم يُحذف أي شيء؛ اطلب من الدعم إغلاق حساب يحتوي على رصيد.",
    warning: "اسحب رصيدك قبل حذف الحساب: أي مبلغ يبقى في المحفظة لا يمكن استعادته بعد ذلك.",
  },
};

export default ar;
