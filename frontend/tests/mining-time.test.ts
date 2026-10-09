import assert from "node:assert/strict";
import { test } from "node:test";
import { setCurrentLanguage } from "../src/shared/i18n/config";
import { utcDateText as miningDateText } from "../src/shared/lib/wallet/wallet-format";
import { liveSnapshot, miningServerNow } from "../src/features/mining/cycle/mining-format";
import type { ApiMiningSession } from "../src/shared/api";

for (const language of ["en", "ar"] as const) {
  test(`mining start and end times agree in Cairo and a UTC privacy browser (${language})`, () => {
    const previousZone = process.env.TZ;
    try {
      setCurrentLanguage(language);
      const dates = ["2026-10-09T16:11:00.000Z", "2026-10-10T02:11:00.000Z"];
      process.env.TZ = "UTC";
      const expected = dates.map(miningDateText);
      process.env.TZ = "Africa/Cairo";
      assert.deepEqual(dates.map(miningDateText), expected);
      assert.ok(expected.every((date) => date.endsWith(" UTC")));
    } finally {
      if (previousZone === undefined) delete process.env.TZ;
      else process.env.TZ = previousZone;
      setCurrentLanguage("en");
    }
  });
}

test("reopening cached mining state advances from receipt time instead of restarting ten hours", () => {
  const serverNow = "2026-10-09T16:11:00.000Z";
  const receivedAt = Date.parse(serverNow) + 120_000; // The device clock is two minutes fast.
  const reopenedAt = receivedAt + 2 * 60 * 60 * 1000;
  const session = {
    startedAt: serverNow,
    endsAt: "2026-10-10T02:11:00.000Z",
    durationSeconds: 36_000,
    rateUnits: 1000,
    rateScale: 1_000_000,
  } as ApiMiningSession;
  assert.equal(liveSnapshot(session, miningServerNow(serverNow, receivedAt, reopenedAt)).remainingSeconds, 28_800);
  assert.equal(liveSnapshot(session, miningServerNow(serverNow, receivedAt, reopenedAt + 8 * 60 * 60 * 1000)).completed, true);
});
