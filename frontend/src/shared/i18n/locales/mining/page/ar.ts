import en from "./en";
import type { Strings } from "@/shared/i18n/types";

const ar: Strings<typeof en> = {
  title: "التعدين",
  description: "حتى 10 ساعات من التعدين في كل نافذة مدتها 24 ساعة، بمعدل يختاره الخادم لحسابك.",
  shortDescription: "اكسب LMA بتعدين حتى 10 ساعات يوميًا.",
  loadError: {
    title: "تعذّر تحميل حالة التعدين",
    retry: "إعادة المحاولة",
  },
  disabled: {
    title: "التعدين غير متاح",
    detail: "التعدين متوقف مؤقتًا على هذه الشبكة. محفظتك غير متأثرة.",
  },
  actions: {
    joinPool: "الانضمام إلى تجمع تعدين",
    start: "بدء التعدين",
    startBusy: "جارٍ بدء التعدين",
    collect: "تحصيل المكافأة",
    collectBusy: "جارٍ تحصيل المكافأة",
    stop: "إيقاف التعدين",
    stopBusy: "جارٍ إيقاف التعدين",
  },
  historyLink: "عرض سجل الدورات",
  historyNote: "— كل دورة سابقة مع أرباحها.",
};

export default ar;
