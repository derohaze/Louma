import en from "./en";
import type { Strings } from "@/shared/i18n/types";

const ar: Strings<typeof en> = {
  title: "الإشعارات",
  description: "إشعارات التحويلات والأمان لهذا الحساب.",
  unreadOne: "إشعار واحد غير مقروء على هذا الحساب.",
  unreadOther: "{count} إشعارات غير مقروءة على هذا الحساب.",
  markAllRead: "تعليم الكل كمقروء",
  unavailable: "الإشعارات غير متاحة",
  all: "كل الإشعارات",
  unreadBadge: "{count} غير مقروء",
  unreadAria: "غير مقروء",
  empty: {
    loading: "جارٍ تحميل الإشعارات…",
    caughtUp: "لا جديد لديك. تظهر هنا إشعارات التحويلات والأمان.",
  },
  loadingOlder: "جارٍ تحميل إشعارات أقدم…",
  loadOlder: "تحميل إشعارات أقدم",
  transfer: {
    sent: {
      title: "تم إرسال تحويل",
      body: "أرسلت {amount} LMA إلى {address}. الرسوم {fee} LMA.",
    },
    received: {
      title: "تم استلام تحويل",
      body: "استلمت {amount} LMA من {address}.",
    },
  },
  bell: {
    ariaUnread: "الإشعارات، {count} غير مقروء",
    viewAll: "عرض الكل",
  },
};

export default ar;
