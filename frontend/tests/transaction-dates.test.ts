import assert from "node:assert/strict";
import { test } from "node:test";
import { setCurrentLanguage } from "../src/shared/i18n/config";
import { transactionDateText } from "../src/shared/lib/wallet/wallet-format";
import { notificationDateText } from "../src/features/notifications/notification-text";

for (const language of ["en", "ar"] as const) {
  test(`transfer dates stay identical across device time zones (${language})`, () => {
    const previousZone = process.env.TZ;
    const dates = ["2026-10-09T00:01:00.000Z", "2026-10-08T23:59:00.000Z", "2026-04-24T00:30:00.000Z"];
    try {
      setCurrentLanguage(language);
      process.env.TZ = "UTC";
      const expected = dates.map(transactionDateText);
      for (const zone of ["Africa/Cairo", "America/Los_Angeles", "Asia/Tokyo"]) {
        process.env.TZ = zone;
        assert.equal(new Intl.DateTimeFormat().resolvedOptions().timeZone, zone);
        assert.deepEqual(dates.map(transactionDateText), expected);
        for (const kind of ["transfer_sent", "transfer_received"] as const) {
          assert.deepEqual(dates.map((createdAt) => notificationDateText({ kind, createdAt })), expected);
        }
      }
      assert.ok(expected.every((date) => date.endsWith(" UTC")));
    } finally {
      if (previousZone === undefined) delete process.env.TZ;
      else process.env.TZ = previousZone;
      setCurrentLanguage("en");
    }
  });
}
