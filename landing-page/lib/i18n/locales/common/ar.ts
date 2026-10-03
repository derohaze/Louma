import en from './en';
import type { Strings } from '@/lib/i18n/types';

const ar: Strings<typeof en> = {
  brand: {
    name: 'لوما',
    tagline: 'محفظة رقمية لـ LMA',
  },
  shell: {
    signIn: 'تسجيل الدخول',
    openWallet: 'افتح محفظتك',
    theme: {
      system: 'وضع النظام',
      light: 'الوضع الفاتح',
      dark: 'الوضع الداكن',
      switchToLight: 'التبديل إلى الوضع الفاتح',
      switchToDark: 'التبديل إلى الوضع الداكن',
    },
    language: {
      label: 'اللغة',
      current: 'اللغة الحالية: {language}',
      switchTo: 'التبديل إلى {language}',
    },
    menu: {
      open: 'فتح القائمة',
      close: 'إغلاق القائمة',
    },
    copyright: '© {year} لوما. جميع الحقوق محفوظة.',
  },
  footer: {
    tagline:
      'المحفظة الرقمية لـ LMA — احتفظ برصيدك، وأرسل واستقبل، واكسب من التعدين، وتابع كل معاملة في مساحة عمل واحدة آمنة.',
    columns: {
      product: 'المنتج',
      resources: 'المصادر',
      company: 'الشركة',
    },
    links: {
      features: 'المميزات',
      pricing: 'الأسعار',
      changelog: 'سجل التحديثات',
      blog: 'المدونة',
      about: 'عن لوما',
      privacy: 'سياسة الخصوصية',
      terms: 'شروط الخدمة',
      privacyShort: 'الخصوصية',
      termsShort: 'الشروط',
    },
    socials: {
      x: 'إكس (تويتر)',
      github: 'جيت هاب',
      linkedin: 'لينكدإن',
      instagram: 'إنستجرام',
    },
  },
  legal: {
    eyebrow: 'قانوني',
    lastUpdated: 'آخر تحديث: {date}',
    onThisPage: 'في هذه الصفحة',
    tableOfContents: 'محتويات الصفحة',
    questionsTitle: 'أسئلة حول هذا المستند؟',
    questionsIntro: 'نقرأ كل رسالة. تواصل معنا في أي وقت عبر',
    questionsOrDocs: 'أو من خلال',
    documentation: 'التوثيق',
    email: 'legal@louma.com',
  },
  blog: {
    backToBlog: 'العودة إلى كل المقالات',
    publishedOn: 'نُشر في {date}',
    readMore: 'اقرأ المقال',
    untitled: 'بدون عنوان',
  },
};

export default ar;