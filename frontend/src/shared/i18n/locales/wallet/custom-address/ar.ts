import en from "./en";
import type { Strings } from "@/shared/i18n/types";

const ar: Strings<typeof en> = {
  title: "عنوان مخصص",
  description: "حدّد عنوان استلام يسهل تذكّره لمحفظتك.",
  current: "العنوان الحالي",
  cadence: "يمكنك تغيير عنوانك المخصص مرة كل 30 يومًا.",
  nextChange: "التغيير التالي متاح في {date}.",
  newAddress: "العنوان الجديد",
  placeholder: "LoumaSignature",
  save: "حفظ العنوان",
  updated: "تم تحديث العنوان.",
  rules: "من 3 إلى 16 حرفًا إنجليزيًا أو رقمًا. يبدأ بحرف، بدون مسافات أو رموز أو @.",
  proRequired: "يلزم اشتراك Pro ساري لاستخدام العنوان المخصص.",
  canonical: "عنوان المحفظة الأصلي",
  fallback: "عند انتهاء Pro يظل العنوان الأصلي متاحًا، ويُتاح العنوان المخصص ليختاره شخص آخر.",
  expires: "ينتهي اشتراك Pro في {date}.",
  monthly: "Pro شهري",
  yearly: "Pro سنوي",
  lifetime: "Pro مدى الحياة",
  history: "سجل العناوين",
  historyDescription: "آخر 20 تغييرًا. جميع العناوين السابقة محفوظة في الأرشيف.",
  noHistory: "لم يتم تغيير العنوان بعد.",
  changed: "تغيير العنوان",
  subscription_expired: "انتهاء Pro",
  subscription_inactive: "لا يوجد اشتراك Pro ساري",
  loadError: {
    title: "العنوان المخصص غير متاح مؤقتًا",
    description: "تعذر تحميل الميزة. تحقق من الاتصال ثم أعد المحاولة.",
  },
  how: {
    title: "كيف يعمل",
    description: "ما الذي يغيّره العنوان المخصص.",
    handle: "المعرّف",
    usedFor: "يُستخدم في",
    usedForValue: "استلام LMA كبديل لعنوان المحفظة",
    changes: "التغييرات",
    changesValue: "مرة كل 30 يومًا",
  },
};

export default ar;
