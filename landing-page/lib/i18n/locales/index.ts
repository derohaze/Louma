import type { LanguageCode } from '../config';
import type { Strings, TranslationKey } from '../types';

import aboutEn from './about/en';
import blogEn from './blog/en';
import changelogEn from './changelog/en';
import commonEn from './common/en';
import featuresEn from './features/en';
import homeEn from './home/en';
import pricingEn from './pricing/en';
import privacyEn from './legal/privacy/en';
import termsEn from './legal/terms/en';
import siteEn from './site/en';

import aboutAr from './about/ar';
import blogAr from './blog/ar';
import changelogAr from './changelog/ar';
import commonAr from './common/ar';
import featuresAr from './features/ar';
import homeAr from './home/ar';
import pricingAr from './pricing/ar';
import privacyAr from './legal/privacy/ar';
import termsAr from './legal/terms/ar';
import siteAr from './site/ar';

/**
 * The central translation file: the one place that knows which sections and pages exist and which
 * language files they have.
 *
 * Every section (and every page inside a section) owns a folder under this directory holding an
 * `en.ts` and an `ar.ts`, and each Arabic file is typed against the English one beside it, so a
 * missing key is a build error instead of a blank label. A section is composed here from those
 * files; a page that needs a second level nests under its section, e.g. `legal/privacy/en.ts`
 * becomes `legal.privacy.*`.
 *
 * Adding a language: copy each `en.ts` to `xx.ts`, translate it, and add the code to `LANGUAGES` in
 * `../config.ts` plus one line in `dictionaries` below. Nothing else in the site changes.
 */
export const en = {
  about: aboutEn,
  blog: blogEn,
  changelog: changelogEn,
  common: commonEn,
  features: featuresEn,
  home: homeEn,
  legal: {
    privacy: privacyEn,
    terms: termsEn,
  },
  pricing: pricingEn,
  site: siteEn,
};

/** The shape every language must have: the English tree with the text widened to `string`. */
export type Dictionary = Strings<typeof en>;

export const dictionaries: Record<LanguageCode, Dictionary> = {
  en,
  ar: {
    about: aboutAr,
    blog: blogAr,
    changelog: changelogAr,
    common: commonAr,
    features: featuresAr,
    home: homeAr,
    legal: {
      privacy: privacyAr,
      terms: termsAr,
    },
    pricing: pricingAr,
    site: siteAr,
  },
};

/**
 * A path to any string in the dictionary (`"home.hero.title"`). Module-level data — the footer
 * columns, the pricing plans, the changelog entries — stores these instead of text, so the same
 * entry renders in whichever language is current when the page paints.
 */
export type TranslationPath = TranslationKey<Dictionary>;