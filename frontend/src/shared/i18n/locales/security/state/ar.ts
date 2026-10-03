import en from "./en";
import type { Strings } from "@/shared/i18n/types";

/** Copy derived from the security API response, in Arabic. */
const ar: Strings<typeof en> = {
  twoFactor: {
    off: "رموز تطبيق المصادقة غير مطلوبة",
    codesRemainingOne: "باقي رمز استرجاع واحد",
    codesRemaining: "باقي {count} رمز استرجاع",
  },
  transferPassword: {
    off: "لا توجد كلمة مرور تحويل منفصلة",
    set: "كلمة مرور التحويل مُعدّة",
    lastChanged: "آخر تغيير {date}",
  },
  wallet: {
    frozen: "مجمّدة",
    active: "نشطة",
  },
  devices: {
    one: "جهاز واحد مسجّل الدخول",
    other: "{count} أجهزة مسجّلة الدخول",
  },
  sessions: {
    one: "جلسة نشطة واحدة على هذه المحفظة.",
    other: "{count} جلسات نشطة على هذه المحفظة.",
  },
  events: {
    unknown: "نشاط أمني",
    login: "تسجيل دخول ناجح",
    loginFailed: "محاولة تسجيل دخول فاشلة",
    logout: "تم تسجيل الخروج",
    passwordChanged: "تم تغيير كلمة المرور",
    twoFactorEnabled: "تم تشغيل المصادقة الثنائية",
    twoFactorDisabled: "تم إيقاف المصادقة الثنائية",
    twoFactorLoginFailed: "فشل التحقق من رمز المصادقة",
    twoFactorLoginSucceeded: "تسجيل دخول بعامل ثانٍ",
    twoFactorSetupFailed: "فشل إعداد تطبيق المصادقة",
    recoveryCodesRegenerated: "تم إنشاء رموز استرجاع جديدة",
    sessionRevoked: "تم إنهاء جلسة",
    transferCompleted: "تم تنفيذ التحويل",
    transferFailed: "فشل التحويل",
    walletFrozen: "تم تجميد المحفظة",
    walletUnfrozen: "تم إلغاء تجميد المحفظة",
    profileUpdated: "تم تحديث الملف الشخصي",
    transferPasswordSet: "تم إعداد كلمة مرور التحويل",
    transferPasswordChanged: "تم تغيير كلمة مرور التحويل",
    walletUnfreezeAuthorized: "تم التصريح بإلغاء التجميد",
    walletAddressChanged: "تم تغيير عنوان الاستلام",
    refreshTokenReuseDetected: "تم رصد إعادة استخدام مشبوهة للجلسة",
  },
};

export default ar;
