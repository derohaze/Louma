import en from "./en";
import type { Strings } from "@/shared/i18n/types";

const ar: Strings<typeof en> = {
  frozen: {
    banner: "المحفظة مجمّدة، لذا يُرفض كل تحويل حتى تلغي التجميد.",
    unfreeze: "إلغاء تجميد المحفظة",
  },
  score: {
    title: "مؤشر الأمان",
    summary: "{enabled} من {total} من وسائل الحماية مُفعّلة. {hint}",
    hintPartial: "فعّل الوسائل المتبقية لسدّ الثغرات.",
    hintFull: "كل وسائل الحماية المتاحة مُفعّلة.",
  },
  devices: {
    title: "الأجهزة المسجّلة الدخول",
    description: "{count} {unit} على هذه المحفظة.",
    all: "كل الأجهزة",
    body: "يبقى الجهاز مسجّل الدخول حتى تنتهي جلسته أو تنهيها أنت. إنهاء الجلسة يوقفها عند أول طلب من ذلك الجهاز.",
  },
  protections: {
    title: "وسائل الحماية",
    description: "افتح أي وسيلة لتشغيلها أو إيقافها؛ الخادم هو من يطبّق التغيير.",
    toggle: "فتح إعدادات {title}",
  },
  controls: {
    title: "أدوات المحفظة",
    description: "التجميد الطارئ وقائمة الأجهزة المسجّلة الدخول.",
  },
  alerts: {
    title: "تنبيهات الأمان",
    description: "ما سجّلته المحفظة على هذا الحساب، الأحدث أولًا.",
    refreshFailed: "تعذّر تحديث تنبيهات الأمان",
    empty: "لم يُسجَّل أي حدث أمني بعد.",
  },
};

export default ar;
