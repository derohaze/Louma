import en from './en';
import type { Strings } from '@/lib/i18n/types';

const ar: Strings<typeof en> = {
  seo: {
    title: 'المدونة',
    description:
      'ملاحظات عملية من لوما حول الاحتفاظ بـ LMA وإرسالها واستقبالها، بتركيز على الوضوح والموثوقية.',
  },
  banner: {
    title: 'مدونة لوما',
    subtitle: 'ملاحظات عملية حول الاحتفاظ بـ LMA وإرسالها واستقبالها، بتركيز على الوضوح والموثوقية.',
    imageAlt: 'لافتة مدونة لوما',
  },
  empty: 'لا توجد مقالات بعد.',
  by: 'بقلم {author}',
  share: 'شارك المقال',
  copied: 'تم نسخ الرابط',
};

export default ar;