import en from "./en";
import type { Strings } from "@/shared/i18n/types";

const ar: Strings<typeof en> = {
  title: "حركة",
  description: "تحويل واحد بمبلغه وضريبته وحالته وإيصاله.",
  notFoundTitle: "لم يتم العثور على الحركة",
  notFoundDetail: "هذا التحويل ليس ضمن سجل هذه المحفظة، أو أن الرابط قديم.",
  allTransactions: "كل الحركات",
  merchant: {
    description: "يتحمل التاجر رسوم المعالجة المثبتة ويدفع المشتري المبلغ الذي وافق عليه.",
    refundDescription: "يعكس هذا الاسترداد دفعة للتاجر باستخدام مبالغ التسوية المسجلة.",
    fee: "رسوم معالجة التاجر",
    feePaidByMerchant: "{amount} — يتحمّلها التاجر",
    operationId: "مرجع الدفع أو الاسترداد",
  },
  heading: {
    sent: "أُرسل {amount}",
    received: "استُلم {amount}",
  },
  breakdown: {
    title: "التفصيل",
    description: "تُخصم ضريبة الشبكة (1%) من المبلغ قبل إضافة الرصيد للمستلم.",
    amountDebited: "المبلغ المخصوم",
    tax: "ضريبة الشبكة (1%)",
    recipientReceived: "ما استلمه المستلم",
    balanceAfter: "الرصيد بعد التحويل",
    amountCredited: "المبلغ المضاف",
    taxPaidBySender: "{amount} — يتحمّلها المرسل",
    senderPaid: "ما دفعه المرسل",
    status: "الحالة",
    note: "ملاحظة",
    transferId: "معرّف التحويل",
    recorded: "تاريخ التسجيل",
  },
  counterparty: {
    title: "الطرف الآخر",
    description: "المحفظة الموجودة على الجانب الآخر من التحويل.",
    sentTo: "هذا هو العنوان الذي أُرسل إليه الـ LMA.",
    sentFrom: "هذا هو العنوان الذي أُرسل منه الـ LMA.",
    supportReference: "مرجع للدعم: {reference}",
  },
  notes: {
    title: "الملاحظات",
    description: "ملاحظة السجل كُتبت وقت الإرسال؛ أما ملاحظتك فمحفوظة على هذا الجهاز.",
    onRecord: "في السجل",
    personal: "شخصية · هذا الجهاز",
    personalAria: "ملاحظة شخصية",
    personalPlaceholder: "مثال: إيجار مارس",
    save: "حفظ الملاحظة",
    add: "إضافة ملاحظة شخصية",
    edit: "تعديل الملاحظة الشخصية",
  },
  next: {
    title: "الخطوة التالية",
    description: "إلى أين يؤدي هذا التحويل.",
    newTransfer: "تحويل جديد",
    print: "طباعة الإيصال",
  },
};

export default ar;
