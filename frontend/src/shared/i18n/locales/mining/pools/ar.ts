import en from "./en";
import type { Strings } from "@/shared/i18n/types";

const ar: Strings<typeof en> = {
  title: "تجمعات التعدين",
  description: "انضم إلى تجمع أولًا — التعدين ممكن فقط من داخل تجمع.",
  shortDescription: "انضم إلى تجمع لبدء التعدين.",
  loadError: "تعذّر تحميل تجمعات التعدين",
  retry: "إعادة المحاولة",
  goToMining: "الذهاب إلى التعدين",
  joined:
    "أنت تعدّن في {pool} · سرعتك {power} H ({share}% من الغرفة). يمكنك تغيير الغرفة في أي وقت — الدورة الجارية تحتفظ بالغرفة التي بدأت فيها.",
  badges: {
    full: "ممتلئ",
    variance: "تقلّب أعلى",
    steady: "ثابت",
  },
  occupancyAria: "إشغال {pool}",
  miners: "{active} / {max} معدّنًا",
  yourShare: " · نصيبك {share}%",
  facts: {
    rewardRange: "نطاق المكافأة",
    roomPower: "قوة الغرفة",
    yourSpeed: "سرعتك",
    cycle: "الدورة",
    cycleValue: "24 ساعة · مرتبطة بهذه الغرفة",
  },
  split:
    "تُقسَّم السرعة على الأعضاء: {power} H ÷ {miners} {unit}. متوسط المكافأة واحد في الغرفتين على المدى الطويل.",
  units: {
    minerOne: "معدّن",
    minerOther: "معدّنين",
  },
  actions: {
    currentRoom: "الغرفة الحالية",
    roomFull: "الغرفة ممتلئة",
    joining: "جارٍ الانضمام…",
    switchTo: "التبديل إلى {pool}",
    join: "الانضمام إلى {pool}",
  },
  how: {
    title: "كيف تعمل الغرف",
    description: "القواعد المشتركة بين الغرفتين.",
    membership: "العضوية",
    membershipValue: "غرفة واحدة في كل مرة — يمكنك الانضمام أو التبديل في أي وقت",
    gate: "شرط التعدين",
    gateValue: "يُرفض البدء حتى تنضم إلى غرفة",
    cycleLength: "مدة الدورة",
    cycleLengthValue: "24 ساعة بالضبط، مرتبطة بغرفتها",
    rewards: "المكافآت",
    rewardsValue: "عامل عشوائي محدود لكل دورة، ونفس المتوسط في الغرفتين",
  },
  names: {
    low: "التجمع المنخفض",
    medium: "التجمع المتوسط",
  },
  descriptions: {
    low: "مكافآت أكثر ثباتًا وتقلّبًا أقل. الأنسب لتعدين يمكن توقّعه.",
    medium: "تقلّب أعلى وإمكانية ربح أكبر. ونفس متوسط التجمع المنخفض على المدى الطويل.",
  },
};

export default ar;
