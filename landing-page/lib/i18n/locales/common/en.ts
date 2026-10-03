/** Words every page reuses: the shell, the legal shell, and the small shared labels. */
export default {
  brand: {
    name: 'Louma',
    /** The brand keeps its own spelling in every language; it is not translated. */
    tagline: 'Digital wallet for LMA',
  },
  shell: {
    signIn: 'Sign in',
    openWallet: 'Open your wallet',
    theme: {
      system: 'System mode',
      light: 'Light mode',
      dark: 'Dark mode',
      switchToLight: 'Switch to light mode',
      switchToDark: 'Switch to dark mode',
    },
    language: {
      label: 'Language',
      current: 'Current language: {language}',
      switchTo: 'Switch to {language}',
    },
    menu: {
      open: 'Open the menu',
      close: 'Close the menu',
    },
    copyright: '© {year} Louma. All rights reserved.',
  },
  footer: {
    tagline:
      'The digital wallet for LMA — hold your balance, send and receive, earn through mining, and track every transaction in one secure workspace.',
    columns: {
      product: 'Product',
      resources: 'Resources',
      company: 'Company',
    },
    links: {
      features: 'Features',
      pricing: 'Pricing',
      changelog: 'Changelog',
      blog: 'Blog',
      about: 'About',
      privacy: 'Privacy Policy',
      terms: 'Terms of Service',
      privacyShort: 'Privacy',
      termsShort: 'Terms',
    },
    socials: {
      x: 'X (Twitter)',
      github: 'GitHub',
      linkedin: 'LinkedIn',
      instagram: 'Instagram',
    },
  },
  legal: {
    eyebrow: 'Legal',
    lastUpdated: 'Last updated: {date}',
    onThisPage: 'On this page',
    tableOfContents: 'Table of contents',
    questionsTitle: 'Questions about this document?',
    /** The sentence around the two links below; each language keeps its own word order. */
    questionsIntro: 'We read every message. Reach us any time at',
    questionsOrDocs: 'or through the',
    documentation: 'documentation',
    email: 'legal@louma.com',
  },
  blog: {
    backToBlog: 'Back to all articles',
    publishedOn: 'Published on {date}',
    readMore: 'Read the article',
    untitled: 'Untitled',
  },
};