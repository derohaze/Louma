import en from "./en";
import type { Strings } from "@/shared/i18n/types";

const ar: Strings<typeof en> = {
  sentTitle: "تم إرسال التحويل",
  summary: "خرج {amount} من محفظتك ووصل {received} إلى {address}، بعد ضريبة الشبكة {tax}.",
  transferId: "معرّف التحويل",
  recorded: "تسجّل المحفظتان هذا التحويل بهذا المعرّف — سجل المرسل وسجل المستلم.",
  view: "عرض الحركة",
  newTransfer: "تحويل جديد",
};

export default ar;
