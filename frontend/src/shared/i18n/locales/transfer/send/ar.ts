import en from "./en";
import type { Strings } from "@/shared/i18n/types";

const ar: Strings<typeof en> = {
  steps: {
    address: "العنوان",
    amount: "المبلغ",
    confirm: "التأكيد",
  },
  address: {
    savedRecipients: "مستلمون محفوظون",
    label: "عنوان محفظة المستلم",
    placeholder: "LMA… (31 حرفًا) أو Ali123",
    own: "هذا عنوانك الخاص.",
    note: "لا يخرج أي شيء من محفظتك في هذه الخطوة: يُتحقق من العنوان في السجل قبل طلب المبلغ أصلًا.",
    checking: "جارٍ التحقق من العنوان…",
  },
  amount: {
    verified: "تم التحقق من العنوان",
    owner: "صاحب المحفظة · {name}",
    change: "تغيير",
    saved: "محفوظ",
    labelPlaceholder: "اسم لهذا المستلم (اختياري)",
    labelAria: "اسم لهذا المستلم",
    saveLabel: "حفظ",
    label: "المبلغ (LMA)",
    tax: "ضريبة الشبكة (1%): {amount}",
    leaves: "يخرج {sent} من محفظتك ويصل {received} إلى المستلم.",
    noFunds: "لا توجد أموال متاحة. شارك عنوان الاستلام لاستلام LMA أولًا.",
    checking: "جارٍ التحقق من السجل…",
  },
  confirm: {
    recipient: "المستلم",
    tax: "ضريبة الشبكة (1%)",
    amount: "المبلغ (LMA)",
    receives: "يستلم المستلم",
    balanceAfter: "الرصيد بعد التحويل",
    paying:
      "الدفع لمحفظة يملكها {name}. تحقق من جانبي العنوان قبل الإرسال: لا يمكن التراجع عن التحويل.",
    authenticatorCode: "رمز المصادقة",
    transferPassword: "كلمة مرور التحويل",
    methodPassword: "كلمة مرور التحويل",
    methodCode: "تطبيق المصادقة",
    codePlaceholder: "رمز من 6 أرقام أو رمز استرجاع",
    passwordPlaceholder: "كلمة مرور التحويل",
    codeNote: "يثبت الرمز التحويل عبر تطبيق المصادقة، ورمز الاسترجاع يعمل أيضًا.",
    passwordNote: "يتحقق منه الـ API قبل تحريك السجل، ولا تخزّنه هذه الصفحة أبدًا.",
    noCredential:
      "لا تحتوي هذه المحفظة على كلمة مرور تحويل أو تطبيق مصادقة، لذا تُرسل مباشرة بعد التأكيد. يمكن إعداد إثبات من قسم الأمان.",
    sending: "جارٍ الإرسال…",
    send: "إرسال {amount}",
  },
  errors: {
    invalidTarget:
      "أدخل عنوان محفظة لوما من 31 رمزًا يبدأ بـ LMA أو عنوان مخصص من 3 إلى 16 حرفًا إنجليزيًا أو رقمًا يبدأ بحرف.",
    ownAddress: "هذا عنوانك الخاص. استخدم محفظة أخرى.",
    quoteFailed: "تعذّر تسعير المبلغ. حاول مرة أخرى.",
    insufficient: "هذا أكثر مما تحمله المحفظة. المتاح {balance}.",
    confirmFirst: "أكّد المستلم والمبلغ أولًا.",
    reapprove: "أكّد المبلغ مرة أخرى كي يعتمده الخادم.",
    frozen: "المحفظة مجمّدة، لذا تُرفض التحويلات.",
    enterCode: "أدخل رمزًا من تطبيق المصادقة.",
    enterPassword: "أدخل كلمة مرور التحويل.",
    shortCode: "الرمز قصير جدًا. أدخل الستة أرقام أو رمز استرجاع.",
  },
};

export default ar;
