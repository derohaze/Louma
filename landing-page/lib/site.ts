export const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL ?? 'https://louma.com').replace(/\/$/, '');

export const siteConfig = {
  name: 'Louma',
  url: siteUrl,
  title: 'Louma | Digital wallet for LMA',
  description:
    'Louma is a digital wallet for holding, sending, and receiving LMA — with mining rewards, a full transaction history, custom receiving addresses, and a built-in security centre.',
  socialImage: '/banner.png',
  keywords: [
    'digital wallet',
    'LMA wallet',
    'send and receive LMA',
    'mining rewards',
    'wallet transaction history',
    'custom receiving address',
    'wallet security centre',
    'hold LMA balance',
    'everyday digital wallet',
    'Egypt digital wallet',
  ],
} as const;
