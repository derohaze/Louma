import en from "./en";
import type { Strings } from "@/shared/i18n/types";

const ar: Strings<typeof en> = {
  pages: {
    center: {
      title: "مركز الأمان",
      description: "طبقات حماية لتسجيل الدخول والتحويلات في محفظتك.",
    },
    twoFactor: {
      title: "التحقق بخطوتين",
      description: "اطلب رمزًا لمرة واحدة من تطبيق المصادقة عند كل تسجيل دخول.",
    },
    transferPassword: {
      title: "كلمة مرور التحويل",
      description: "اطلب كلمة مرور منفصلة قبل اعتماد أي تحويل.",
    },
    freeze: {
      title: "تجميد المحفظة",
      description: "أوقف كل التحويلات وتسجيلات الدخول فورًا، ثم ارفع التجميد عندما تكون مستعدًا.",
    },
    devices: {
      title: "الأجهزة والجلسات",
      description: "اطّلع على كل جهاز مسجّل الدخول لهذه المحفظة وأنهِ الجلسات التي لا تعرفها.",
    },
  },
};

export default ar;
