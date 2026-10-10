import en from "./en";
import type { Strings } from "@/shared/i18n/types";

const ar: Strings<typeof en> = {
  header: {
    brand: "لوما",
    logoAlt: "شعار لوما",
    searchAria: "بحث",
    billingAria: "الفواتير والاشتراك",
    accountMenuAria: "قائمة الحساب",
  },
  search: {
    dialogAria: "ابحث في لوما",
    placeholder: "ابحث في الصفحات والتحويلات والإعدادات",
    mostUsed: "الأكثر استخدامًا",
    results: "النتائج",
    noMatches: "لا توجد نتائج لـ «{query}».",
    cantFind: "لم تجد ما تبحث عنه؟",
    newTransfer: "تحويل جديد",
  },
  menu: {
    fallbackName: "محفظة لوما",
    notSignedIn: "لم تسجّل الدخول",
    profile: "الملف الشخصي",
    security: "الأمان",
    settings: "الإعدادات",
    developer: "المطور",
    darkMode: "الوضع الليلي",
    logOut: "تسجيل الخروج",
    language: "اللغة",
    signOutFailedTitle: "لم يتم تأكيد تسجيل الخروج",
    signOutFailedDetail: "{reason} قد تكون الجلسة على هذا الجهاز لا تزال نشطة. حاول مرة أخرى.",
  },
  breadcrumb: {
    home: "الرئيسية",
  },
  notice: {
    frozen: "المحفظة مجمّدة، لذا سيُرفض كل تحويل حتى ترفع التجميد.",
  },
  /** The document itself: the browser tab and the description search engines would read. */
  document: {
    title: "لوما — المحفظة",
    description: "محفظة لوما: الرصيد والتحويلات والتعدين والحركات.",
  },
  notFound: {
    title: "الصفحة غير موجودة",
    detail: "الصفحة التي تبحث عنها غير موجودة أو تم نقلها.",
    goHome: "العودة إلى الرئيسية",
  },
  fatal: {
    title: "لم يتم تحميل هذه الصفحة",
    detail: "حدث خطأ من جانبنا. يمكنك إعادة المحاولة أو العودة إلى الرئيسية.",
    retry: "إعادة المحاولة",
    goHome: "العودة إلى الرئيسية",
  },
  error: {
    unavailable: "المحفظة غير متاحة",
    tryAgain: "إعادة المحاولة",
    frozenTitle: "المحفظة مجمّدة",
    frozenDetail:
      "يُرفض كل تحويل ما دامت المحفظة مجمّدة. لم يُفقد أي شيء: ارفع التجميد لتعمل المحفظة كما كانت.",
    openFreeze: "فتح تجميد المحفظة",
  },
};

export default ar;
