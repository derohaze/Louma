import type { LanguageCode } from "../config";
import type { Strings } from "../types";

import analyticsEn from "./analytics/en";
import authEn from "./auth/en";
import billingEn from "./billing/en";
import commonEn from "./common/en";
import miningPageEn from "./mining/page/en";
import miningCycleEn from "./mining/cycle/en";
import miningHistoryEn from "./mining/history/en";
import miningPoolsEn from "./mining/pools/en";
import navEn from "./nav/en";
import notificationsEn from "./notifications/en";
import overviewEn from "./overview/en";
import profileEn from "./profile/en";
import shellEn from "./shell/en";
import securityCatalogEn from "./security/catalog/en";
import securityCenterEn from "./security/center/en";
import securityDevicesEn from "./security/devices/en";
import securityFreezeEn from "./security/freeze/en";
import securityStateEn from "./security/state/en";
import securityTransferPasswordEn from "./security/transfer-password/en";
import securityTwoFactorEn from "./security/two-factor/en";
import settingsAccountEn from "./settings/account/en";
import transactionsListEn from "./transactions/list/en";
import transactionsDetailEn from "./transactions/detail/en";
import transferPageEn from "./transfer/page/en";
import transferSendEn from "./transfer/send/en";
import transferReceiptEn from "./transfer/receipt/en";
import transferRecipientsEn from "./transfer/recipients/en";
import validationEn from "./validation/en";
import walletPageEn from "./wallet/page/en";
import walletCustomAddressEn from "./wallet/custom-address/en";

import analyticsAr from "./analytics/ar";
import authAr from "./auth/ar";
import billingAr from "./billing/ar";
import commonAr from "./common/ar";
import miningPageAr from "./mining/page/ar";
import miningCycleAr from "./mining/cycle/ar";
import miningHistoryAr from "./mining/history/ar";
import miningPoolsAr from "./mining/pools/ar";
import navAr from "./nav/ar";
import notificationsAr from "./notifications/ar";
import overviewAr from "./overview/ar";
import profileAr from "./profile/ar";
import shellAr from "./shell/ar";
import securityCatalogAr from "./security/catalog/ar";
import securityCenterAr from "./security/center/ar";
import securityDevicesAr from "./security/devices/ar";
import securityFreezeAr from "./security/freeze/ar";
import securityStateAr from "./security/state/ar";
import securityTransferPasswordAr from "./security/transfer-password/ar";
import securityTwoFactorAr from "./security/two-factor/ar";
import settingsAccountAr from "./settings/account/ar";
import transactionsListAr from "./transactions/list/ar";
import transactionsDetailAr from "./transactions/detail/ar";
import transferPageAr from "./transfer/page/ar";
import transferSendAr from "./transfer/send/ar";
import transferReceiptAr from "./transfer/receipt/ar";
import transferRecipientsAr from "./transfer/recipients/ar";
import validationAr from "./validation/ar";
import walletPageAr from "./wallet/page/ar";
import walletCustomAddressAr from "./wallet/custom-address/ar";

/**
 * The central translation file: the one place that knows which sections and pages exist and which
 * language files they have.
 *
 * Every section (and every page inside a section) owns a folder under this directory holding an
 * `en.ts` and an `ar.ts`, and each Arabic file is typed against the English one beside it, so a
 * missing key is a build error instead of a blank label. A section is composed here from those
 * files; a page that needs a second level nests under its section, e.g. `wallet/page/en.ts` becomes
 * `wallet.page.*`.
 *
 * Adding a language: copy each `en.ts` to `xx.ts`, translate it, and add the code to `LANGUAGES` in
 * `../config.ts` plus one line in `dictionaries` below. Nothing else in the app changes.
 */
export const en = {
  analytics: analyticsEn,
  auth: authEn,
  billing: billingEn,
  common: commonEn,
  mining: {
    page: miningPageEn,
    cycle: miningCycleEn,
    history: miningHistoryEn,
    pools: miningPoolsEn,
  },
  nav: navEn,
  notifications: notificationsEn,
  overview: overviewEn,
  profile: profileEn,
  shell: shellEn,
  security: {
    catalog: securityCatalogEn,
    center: securityCenterEn,
    devices: securityDevicesEn,
    freeze: securityFreezeEn,
    state: securityStateEn,
    transferPassword: securityTransferPasswordEn,
    twoFactor: securityTwoFactorEn,
  },
  settings: {
    account: settingsAccountEn,
  },
  transactions: {
    list: transactionsListEn,
    detail: transactionsDetailEn,
  },
  validation: validationEn,
  transfer: {
    page: transferPageEn,
    send: transferSendEn,
    receipt: transferReceiptEn,
    recipients: transferRecipientsEn,
  },
  wallet: {
    page: walletPageEn,
    customAddress: walletCustomAddressEn,
  },
};

/** The shape every language must have: the English tree with the text widened to `string`. */
export type Dictionary = Strings<typeof en>;

export const dictionaries: Record<LanguageCode, Dictionary> = {
  en,
  ar: {
    analytics: analyticsAr,
    auth: authAr,
    billing: billingAr,
    common: commonAr,
    mining: {
      page: miningPageAr,
      cycle: miningCycleAr,
      history: miningHistoryAr,
      pools: miningPoolsAr,
    },
    nav: navAr,
    notifications: notificationsAr,
    overview: overviewAr,
    profile: profileAr,
    shell: shellAr,
    security: {
      catalog: securityCatalogAr,
      center: securityCenterAr,
      devices: securityDevicesAr,
      freeze: securityFreezeAr,
      state: securityStateAr,
      transferPassword: securityTransferPasswordAr,
      twoFactor: securityTwoFactorAr,
    },
    settings: {
      account: settingsAccountAr,
    },
    transactions: {
      list: transactionsListAr,
      detail: transactionsDetailAr,
    },
    validation: validationAr,
    transfer: {
      page: transferPageAr,
      send: transferSendAr,
      receipt: transferReceiptAr,
      recipients: transferRecipientsAr,
    },
    wallet: {
      page: walletPageAr,
      customAddress: walletCustomAddressAr,
    },
  },
};
