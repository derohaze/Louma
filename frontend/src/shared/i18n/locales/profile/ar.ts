import en from "./en";
import type { Strings } from "@/shared/i18n/types";

const ar: Strings<typeof en> = {
  title: "الملف الشخصي",
  description: "بيانات حسابك ونشاط المحفظة المرتبط بها.",
  accountSettings: "إعدادات الحساب",
  identity: {
    title: "الهوية",
    description: "كيف يظهر حسابك داخل المحفظة.",
    displayName: "الاسم المعروض",
    country: "الدولة",
    selectCountry: "اختر دولة",
    save: "حفظ الملف",
    saved: "تم حفظ الملف.",
  },
  glance: {
    title: "المحفظة في لمحة",
    description: "أرقام مأخوذة من المحفظة نفسها.",
    balance: "الرصيد المتاح",
    transfers: "التحويلات المسجّلة",
    protections: "الحمايات المفعلة",
    protectionsValue: "{enabled} من {total} · النتيجة {score}/{max}",
    status: "حالة المحفظة",
  },
  account: {
    title: "الحساب",
    description: "معرّفات قد تحتاجها عند التواصل مع الدعم.",
    id: "معرّف الحساب",
    address: "عنوان المحفظة",
    email: "البريد الإلكتروني",
    memberSince: "عضو منذ",
  },
  links: {
    title: "الحماية والتفضيلات",
    description: "القسمان متاحان أيضًا من قائمة الحساب بجانب هذه الصفحة.",
    security: "مركز الأمان",
    securityDetail: "{enabled} من {total} حمايات مفعلة · النتيجة {score}/{max}",
    settings: "الإعدادات",
    settingsDetail: "الحساب وهوية المحفظة",
  },
};

export default ar;
