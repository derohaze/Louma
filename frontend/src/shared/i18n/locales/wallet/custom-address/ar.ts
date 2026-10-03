import en from "./en";
import type { Strings } from "@/shared/i18n/types";

const ar: Strings<typeof en> = {
  title: "عنوان مخصص",
  description: "حدّد عنوان استلام يسهل تذكّره لمحفظتك.",
  current: "العنوان الحالي",
  cadence: "يمكنك تغيير عنوانك المخصص مرة كل 30 يومًا.",
  nextChange: "التغيير التالي متاح في {date}.",
  newAddress: "العنوان الجديد",
  placeholder: "your_name",
  save: "حفظ العنوان",
  updated: "تم تحديث العنوان.",
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
