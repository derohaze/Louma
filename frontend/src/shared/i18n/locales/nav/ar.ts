import en from "./en";
import type { Strings } from "@/shared/i18n/types";

const ar: Strings<typeof en> = {
  sections: {
    home: "الرئيسية",
    wallet: "المحفظة",
    transfer: "التحويل",
    mining: "التعدين",
    transactions: "الحركات",
    profile: "الملف الشخصي",
    security: "الأمان",
    settings: "الإعدادات",
  },
  pages: {
    overview: {
      label: "نظرة عامة",
      search: "الرصيد لوحة التحكم الرئيسية نظرة عامة",
    },
    analytics: {
      label: "التحليلات",
      search: "تحليلات رسوم بيانية إحصائيات دخل مصروفات تعدين تحويلات نشاط",
    },
    notifications: {
      label: "الإشعارات",
      search: "إشعارات تنبيهات أمان تحويلات غير مقروء",
    },
    wallet: {
      label: "المحفظة",
      search: "الرصيد عنوان الاستلام",
    },
    customAddress: {
      label: "عنوان مخصص",
      search: "عنوان الاستلام رمز الاستجابة qr",
    },
    transfer: {
      label: "تحويل",
      search: "إرسال تحويل استلام أموال",
    },
    recipients: {
      label: "المستلمون",
      search: "المحفوظون الأخيرون المفضلة العناوين",
    },
    mining: {
      label: "التعدين",
      search: "تعدين مكافآت معدل دورة أرباح كسب",
    },
    miningPools: {
      label: "تجمعات التعدين",
      search: "تجمعات تعدين انضمام غرفة مجتمع منخفض متوسط",
    },
    miningHistory: {
      label: "السجل",
      search: "سجل دورات التعدين الأرباح المحصّلة السابقة",
    },
    transactions: {
      label: "الحركات",
      search: "حركات سجل تحويلات بحث تصفية",
    },
    profile: {
      label: "الملف الشخصي",
      search: "بيانات الحساب الهوية",
    },
    securityCenter: {
      label: "مركز الأمان",
      search: "مركز الأمان النتيجة طبقات تسجيل الدخول التحويلات الحمايات",
    },
    twoFactor: {
      label: "التحقق بخطوتين",
      search: "التحقق بخطوتين تطبيق المصادقة رمز لمرة واحدة تسجيل الدخول",
    },
    transferPassword: {
      label: "كلمة مرور التحويل",
      search: "كلمة مرور التحويل تأكيد منفصل اعتماد",
    },
    freeze: {
      label: "تجميد المحفظة",
      search: "تجميد المحفظة إيقاف طارئ رفض التحويلات رفع التجميد",
    },
    devices: {
      label: "الأجهزة",
      search: "الأجهزة الجلسات تسجيل الدخول تعرف إلغاء",
    },
    account: {
      label: "الحساب",
      search: "الإعدادات إدارة الحساب الهوية دورة الحياة",
    },
  },
  chrome: {
    more: "المزيد",
    allPages: "كل الصفحات",
    allPagesDescription: "كل صفحات لوما، مجمّعة حسب القسم.",
    primaryNav: "التنقل الرئيسي",
    pageInSection: "قسم {section}",
  },
};

export default ar;
