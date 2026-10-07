# Mining privacy-browser hardening — verification

Date: 2026-10-05. Changes are local only; no deployment, commit or production-data repair was performed.

## Policy correction — 2026-10-07

The current start service requires a non-null machine correlation key, derived from at least four
reported core slots. Generic or missing GPU names alone no longer refuse mining: graphics are
corroborating evidence, and privacy settings can mask them on an otherwise usable device. Thin and
key-only payloads still return `mining_device_evidence_required`. Existing device leases, enrollment
limits, network admission and account/device quotas still apply.

Near clones share a quota only when their compared CPU and memory classes do not contradict. A clone
of an enrolled clone inherits its stored `quotaAnchorHash` only if it also matches the original quota
owner's near-clone band; similarity cannot be chained through successive records. A class
contradiction or a failed direct comparison gets its own allowance.

The masked-graphics refusals and acceptance criteria below describe the previous policy and
historical measurements, superseded by this correction. No new real-browser verification is claimed.

## Acceptance criteria and behavior

- Reject mining starts with insufficient or masked machine evidence, even when the caller supplies a new browser key or a high fingerprint confidence. This is a mining admission refusal, not an account ban.
- Enforce the check in the server start service before device registration, enrollment-budget consumption or IP intelligence calls. A client-side check alone is not security.
- Keep `mining_device_evidence_required` (HTTP 400) distinct from `mining_device_already_in_use` (HTTP 409). English and Arabic UI messages explain missing information without inventing an active cycle.
- Require a non-null machine correlation key and non-generic graphics evidence. Known generic renderer labels (`Mozilla`, `WebKit WebGL`, `brave`, etc.) and missing graphics do not satisfy this admission policy. The rule checks evidence, not the browser's name.
- Count a device/network lease as live only when its referenced MongoDB mining session belongs to the lease owner, is active and has not ended. Release inactive/expired rows in the start transaction before inserting the new cycle and leases; retain the unique-index concurrency protection.
- Attribute presentation/rendering drift to a known machine only after a positive correlation, not merely because an unrelated computer shares several generic traits.
- Do not silently treat failed live-lease backstop reads as an empty result.
- Preserve financial journal pairing, quotas, uniqueness and existing transaction boundaries. No new indexes, no new collections and no new production dependencies; the only document-contract addition in the second pass is the optional `boundBrowserKeyFingerprint` on challenge nonces (additive, permitted by the existing validator).

## Real browser test

Installed executable: Mullvad Browser for Windows, version 15.0.24 (Firefox-compatible UA 140.0). Selenium launched separate temporary profiles; the user's normal browser profile was not modified. Fingerprint resistance was explicitly enabled in the automated profile. This is an automated-browser result, not a claim of exhaustive testing of all Mullvad configurations.

The project's actual evidence collector reported a generic `Mozilla` graphics identity. Two collections produced different canvas digests. These observations disprove treating every browser-visible machine trait as a guaranteed stable physical identifier.

Verified through real UI interactions against a loopback API and a task-owned local MongoDB replica-set database:

1. Register a new temporary account.
2. Open mining; confirm the pool requirement.
3. Join Low Pool through its button.
4. Open mining and press **Start mining**.
5. Observe the insufficient-device-information message, including **Your account is not blocked**.
6. Read fresh API state: `status: idle`, `session: null`, `consumedSeconds: 0`, `remainingSeconds: 36000`.
7. Count database artifacts: one test account; zero mining sessions, device leases, device records and enrollment slots.

Screenshot: [Mullvad mining refusal](artifacts/mullvad-mining-refusal.png).

A separate real Mullvad API/orchestration test also returned HTTP 400 with `mining_device_evidence_required`, while account registration and mining-state reads remained available.

## Second pass — additional attacks measured and closed

Two further attacks were reproduced through the HTTP API against a task-owned local replica-set database, and both were fixed at the source. Each has a permanent regression in the mining-device integration suite.

### 1. Two fresh identities racing on one network both started mining

- Attack: two new accounts with two different simulated machines, one shared server-observed address, both `POST /api/v1/mining/start` at the same moment.
- Measured before the fix: both requests returned HTTP 200 with two distinct active sessions, each granted the full 36,000-second allowance. The network rule was evaluated before the transaction: both transactions saw no live foreign lease, and each inserted its own disjoint lease rows, so both committed.
- Fix: a start that must pass the network rule (its resolved cluster is not a resident of its network) leases one reserved per-network token (`net:<network hash>`) together with its device leases, inside the same transaction. Two racing fresh identities now collide on the existing unique active-lease index: one commits, the loser's transaction aborts, and the loser re-reads the committed state and is refused with `mining_device_network_in_use`. Residents take no token, exactly as they are exempt from the rule itself (ENROLL-C still passes), and monitor mode still takes no leases. No new collection and no new index: the token is one more lease row in a reserved `deviceClusterId` namespace, and the readers that mean "a lease on a device" (device status, live-lease backstop) exclude it.
- Measured after the fix: exactly one 200 and one 409 (`mining_device_network_in_use`), one active session, and the refused racer holds no active lease of its own. D+L (sequential network refusal) and ENROLL-C (resident exemption) still pass.

### 2. A challenge anchored to one browser key was accepted with another key's signature

- Attack: request a challenge with evidence naming browser key A (whose machine traits resolve an anchor), then sign the returned payload with an unrelated key B and submit B as `publicKeyJwk` alongside the same evidence.
- Measured before the fix: HTTP 200 `{ verified: true }` — the handshake was consumed even though the key the challenge was issued for never signed anything. Only key-only enrollments (no machine anchor) compared the signing key to the evidence's key.
- Fix: the challenge now stores the `x|y` fingerprint of the browser key its evidence named (`boundBrowserKeyFingerprint`), and the consuming proof must be signed by exactly that key's private half — compared by key material (`p256KeyFingerprint`), so a re-encoded JWK of the same key still verifies. A mismatch is refused before the nonce is consumed. A challenge issued with no named key binds no key (and still credits no cluster), so the evidence-less legacy flow is unchanged (G+H).
- Measured after the fix: the swapped-key proof returns 401 and leaves the nonce unconsumed; signing the same challenge with the key it was issued for then returns 200 and consumes it.

### 3. Follow-up repairs from the same audit

- `GET /api/v1/mining/device/status` now derives `bound` from the referenced session being active, owned by the account and unended — the same liveness rule admission applies, through `findLiveLeasesForOwner` — so a lease row left behind by a settled or expired cycle stops claiming the device. The regression was verified by temporarily restoring the old query: the new assertion failed with "a settled session does not keep the device bound", and passes with the fix.
- The frontend maps `mining_device_network_in_use` to a dedicated English/Arabic message (`mining.cycle.errors.networkInUse`) instead of falling back to the generic error text, so the customer reads what to wait for when another account is already mining from their network.

## Third pass — mining with more than one account on one computer

A dedicated probe (`back-end/src/tests/lmdg-same-device-probe.ts`, test-only) drove 15 attack
scenarios through the real HTTP routes against a task-owned database: two fresh accounts per
scenario, on machines that vary by scenario in platform, screen, CPU class, memory, touch, capture
devices, gamut, HDR, panel depth, timezone and rendering stack (audio device unique per scenario).
Profile B is the same computer observed differently — a second engine (Firefox, with and without a
live media stack), one or two edited engine-stable identity slots, byte-identical evidence, or a
presentation-only spoof — run sequentially or racing, on distinct networks or on one shared network.
A scenario breaches if the two accounts end up with more than one active cycle; sessions are stopped
between scenarios so each starts from a clean population.

- Attack that succeeded before the fix (scenario S7, sequential, two networks): B kept four of the
  six identity slots (CPU class, touch class, panel depth, HDR) and edited the other two (display
  gamut and audio device) under a Firefox-shaped profile. Both starts returned HTTP 200: two device
  records, two machine keys, two active sessions — the same computer mining under two accounts.
  Mechanism: editing two slots forks `machineKeyHash`; the Firefox-owned corroborators (fonts,
  capture devices, the memory class Firefox cannot report) had also moved, so the weighted score fell
  below the ambiguity threshold, and with no class-trait disagreement (CPU class identical, memory
  class unreported) the pair was classified "different" — a fresh identity, and on a second network
  a fresh lease, so nothing refused it.
- Fix (`modules/mining-device/identity.ts`): a near-clone band in `decideClusterMatch` — at least one
  compared class trait, at least four of the six engine-stable identity slots agreed on, and at least
  two of the same six reporting different hardware (`MIN_CORE_IDENTITY_AGREEMENTS = 4`,
  `MIN_CORE_IDENTITY_MOVES = 2`) — resolves to `ambiguous` before the positive-sharing paths, on the
  identity slots alone rather than the weighted score, because the traits that would lower the score
  are exactly the ones two browsers of one computer disagree about by construction. An ambiguous
  cluster is never merged into the known record; with a live foreign lease admission refuses it
  (`device_cluster_lease_ambiguous`, surfaced as the existing 409
  `mining_device_already_in_use`). A real machine or a second browser on it moves zero identity
  slots, so the band cannot touch it.
- Measured after the fix (fresh database, exit 0): S7 is now `[200, 409] mining_device_already_in_use`
  with one active session — B's edited identity is enrolled, but its start is refused while A's cycle
  holds the machine. All 15 scenarios report zero breaches; the race variants resolve to one 200 and
  one refusal (409 lease/challenge), and the one-network variants stay blocked by the network rule.
- Standing regressions in the mining-device integration suite: NEAR-CLONE (sequential), NEAR-CLONE
  RACE (concurrent) and FIXTURE ISOLATION (the suite's simulated machines must not correlate with
  each other).

Honest limits of this pass: the refusal is bounded by the live lease. Two accounts on one computer
can still take turns — the edited identity is refused only while the known machine is mining, then it
is free to enroll, exactly as the policy's conservative middle intends; the pass closes *simultaneous*
multi-account cycles, not sequential account switching. And a genuinely different machine that reports
the same four identity slots with two moved is refused while that other machine mines, the same
wait-until-the-cycle-ends cost the pre-existing "same machine" path always carried.

## Fixture isolation repairs (found while re-running the attacks)

- A device record left behind by a run (minted by a direct `resolveOrCreateDevice` probe, with no lease and no observation) is invisible to the suite's old cleanup. On the next run, fresh thin observations correlated into it as "the same machine", silently skipping the enrollment budget: ENROLL-D measured 5 created out of 5 against a budget of 3 on the second run of the same database. The cleanup now deletes device rows by `enrollmentUserId` of the run's accounts.
- Enrollment slots are keyed by account or network hash, and the suite reuses fixed probe addresses, so the per-network budget accumulated across runs until a later run's fresh device was refused for the wrong reason (measured: the network-race attack turned into `enrollment_limited`). The cleanup now deletes the run's enrollment slots both by account and by the hash of every address the run observed.
- The suite's synthetic machines were built from a small 4-bit group code plus a parity slot, which
  repeated every 32 indices; the fixture 32 steps later had agreed on every machine slot except its
  unique audio device and correlated as one machine (`machineScore 82`), so a test using fixture *i*
  could inherit a live lease from the test that used fixture *i+32*. A new FIXTURE ISOLATION
  regression (recomputing the real verdict for all 64 fixture pairs) caught it, and a corroborator
  bucket shift carried by the upper index bits kept the first 128 fixtures apart.
- Re-running the suite after that repair surfaced the same class again, in shapes no pristine sweep
  could see. First, the near-clone guard made the *pinned* slots of the `laptop-y` fixture a
  liability: it hard-coded CPU class, memory class, capture devices, gamut, screen and timezone, so
  two `laptop-y` fixtures from different tests agreed on four of the six identity slots and moved
  exactly the touch class and the audio device — the band — and the second one was refused
  `mining_device_already_in_use` while the first mined (measured: the ATTACK network race, refused
  because STALE leaves its `laptop-y` cycle running; the failing assertion named `already_in_use`
  where the test requires `network_in_use`). The fixture now pins only the machine's *description*
  (user agent, platform, version) and derives every compared slot from the index.
- Second, a `laptop-x-firefox-engine` fixture — which by design reports neither `deviceMemory` nor
  the capture devices — matched a fixture in the adjacent code group on every machine trait it could
  report: five of six identity slots agreed, the untouched memory and capture buckets could not
  break the tie, and `machineScore` 78 sat exactly on the high threshold, so the pair resolved
  "same". The variant matrix added to FIXTURE ISOLATION (all fixture kinds, 40 salts, every
  cross-salt pair must be "different") surfaced it, along with score-only collisions between salts
  of the `laptop-x-second-browser` fixture, whose pinned Brave GPU and rendering digests kept
  unrelated variants above the ambiguity score; those digests are now namespaced by the salt like
  every other browser-owned value.
- The fixture core is now a certificate code rather than a repeating group: four data slots (CPU
  class, touch class, display gamut, HDR) carry a mixed-radix index, the panel colour depth is their
  weighted-sum certificate (nonzero for every change of any one of them, so the code has minimum
  distance two), and the audio device stays unique per index. Any two distinct indices differ in at
  least three of the six engine-stable slots whatever corroborators an engine reports — verified by
  brute force over all 4,005 pairs within capacity — so no pair can land on the one-moved "same"
  path or the two-moved near-clone band. Capacity is 90 machines, and the regression asserts the
  suite stays inside it instead of silently wrapping and reusing an index.
- The mining API/ledger suite's own machine generator had the same exposure (coarse CPU, binary
  touch/HDR panel, three gamuts): two tests failed with `mining_device_already_in_use` on starts
  that must succeed, because the machine they drew agreed with a still-mining neighbour on four
  identity slots and moved two. That generator now uses the same certificate code, and the suite
  gained its own FIXTURE ISOLATION regression (all 90 machines, real matcher) so a future edit
  cannot silently reintroduce a colliding pair.

## Fourth pass — a user who has never mined

A dedicated test-only probe (`back-end/src/tests/lmdg-first-mining-probe.ts`) walks a never-mined
account through the real HTTP routes against a task-owned database. One scenario is one fresh account
(plus, where needed, an established miner) and one unmistakably distinct simulated machine.

| Scenario | What it does | Measured | Verdict |
| --- | --- | --- | --- |
| F1 | brand-new account, device and network | `200`, one active cycle, one device record | a first-ever start is admitted |
| F2 | another account on a machine of the same model (identical six identity slots; different RAM class, capture devices, rendering stack, screen, locale, network) while that model mines | `[200, 409] mining_device_already_in_use` | model-level identity, documented cost |
| F8 | the same pair after the first account stops | `[200, 200]` | the refusal is bounded by the live lease |
| F3 | a second machine on one shared address while the first mines | `[200, 409] mining_device_network_in_use` | intended network rule |
| F4 | nine distinct machines enrolling from one address, then a tenth brand-new user | before the fix: tenth `403 mining_device_enrollment_limited`; after: `409 mining_device_network_in_use` | false positive, fixed below |
| F5 | masked graphics evidence (privacy-browser shape) | `400 mining_device_evidence_required` | intended |
| F6 / F7 | two accounts, byte-identical evidence, sequential and concurrent | `[200, 409]` both ways, exactly one active cycle | one device, one account |
| F9 | three accounts, one device | one `200`, two `409`, one active cycle | one device, one account |

**Diagnosis.** The reported "a user who never mined was blocked" is not unconditional: F1 is admitted,
and every refusal that can hit a first-time user is either a documented policy (masked evidence, one
network, one device) or the *model-level* machine identity. That identity hashes six engine-stable
traits (`machineKeyHash`), so two different computers of one model are one identity and the second one
waits for the first cycle to end (F2, which F8 shows is bounded). The one refusal no anti-abuse
property requires is F4: the per-network identity-creation counters were sized for one person, while
one observed address is a NAT or carrier-grade NAT shared by many unrelated customers. With the
counters sized for a shared address, that tenth user is enrolled and is then refused by the
lease-bounded network rule like any other fresh machine behind a live cycle — refused for the reason
that is true, and free again when that cycle ends.

A second, smaller defect sat behind the same symptom. After the cycle and its lease had committed,
the success audit write was awaited without the non-fatal `.catch` the rest of the service applies to
audit writes, so a failed write turned a start that *happened* into an error response, and the
customer's retry then read `mining_cycle_active` — an error followed by a block, for a user whose
first cycle was running the whole time.

**Fixes.**

- Shared-address sizing of the per-network counters (`back-end/src/config/env.ts`): defaults
  `LMDG_MAX_NEW_CLUSTERS_PER_NETWORK_PER_HOUR` 8 → 40 and `LMDG_MAX_NEW_CLUSTERS_PER_NETWORK_PER_DAY`
  20 → 200, still env-overridable. The binding control for "two identities on one network" is the
  per-network lease token, which is untouched, and the per-account budget stays 3/day — the account
  remains the per-person limit, so an address still cannot mint identities at machine rate.
  **Historical, not current:** the sixth pass re-tightened these defaults to **20/hour and 40/day**
  once they had to serve a second job (bounding the fresh allowances an identity-editing client can
  mint). The 40/200 figures below describe what this pass measured at the time.
- Honest refusal wording: `DEVICE_IN_USE_MESSAGE` (`back-end/src/modules/mining-device/policy.ts`)
  now names both causes — this device, or a machine the guard identifies as the same hardware —
  instead of asserting the caller's device is mining, and `DEVICE_ENROLLMENT_LIMITED_MESSAGE` states
  that the limit is temporary and the account is not blocked. The frontend twin in
  `frontend/src/features/mining/device-guard/evidence-types.ts` is kept byte-identical, because the
  cycle hook compares it as a sentinel.
- A committed start can no longer be reported as an error (`back-end/src/modules/mining/start.ts`):
  the post-commit `mining_started` audit write follows the same non-fatal discipline as every other
  audit write in the service — logged, never thrown.
- Regression: the `ONBOARD` test in `back-end/src/tests/mining-device.integration.test.ts` pins the
  contract — a first-ever start is `200` with a `provisional` enrollment owned by the caller and a
  full window ahead, and three accounts cannot take that machine, sequentially or racing, with
  exactly one active cycle.

**Honest limits.** F2 and F3 are not fixed: relaxing the model-level machine key re-opens the measured
one-edited-core-slot pair (`S5`/`S6`), and relaxing the network rule re-opens the same-network race the
lease token closes. A privacy browser that masks its graphics is still refused by policy. The
per-network counters remain bounds, so a sufficiently busy shared address can still reach them; the
values are tunable per deployment.

## Fifth pass — alternating accounts, an edited slot, and the audit trail

Two requests drove this pass: one operational (a burst of refused brand-new users must be visible
*before* it is a support queue) and the one the fourth pass left open itself — its honest limit said
the guard closes *simultaneous* multi-account cycles, not *sequential account switching*.

### The open path, measured

Device quota is one 10h/24h allowance per machine, keyed on the cluster's immutable machine anchor
(`deviceQuotaKeyFor`, `back-end/src/modules/mining/quota.ts`), so two accounts on one *resolved* device
already share it. What stayed open is the pair of cases where the identity is deliberately edited
between accounts, and the near-clone band said so in its own words: "free to enroll once it is not".
A near clone is **not merged** — it enrolls its own record with its own `anchorHash` — so after
account A stopped, account B's edited fingerprint landed on a **fresh 10h device window** beside A's
spent one: one computer mining 20 hours in one 24-hour window, in two accounts, sequentially.

### The fix

The near-clone band now also answers *which machine the allowance belongs to* (`isNearCloneMatch`,
`back-end/src/modules/mining-device/identity.ts`). The verdict is unchanged — still `ambiguous`, still
not merged, still refused while the known cycle is live — but resolution returns the matched machine's
stable anchor as `quotaAnchor` (`back-end/src/modules/mining-device/resolution.ts`), and the device
quota subject prefers it (`back-end/src/modules/mining/start.ts`). An edited slot now shares the
machine's window instead of buying a new one.

Two properties make it safe to rely on:

- **Nothing is loosened.** No start that was refused before is admitted: the change only moves a
  *ceiling* onto the edited fingerprint. `S5`/`S6` (one edited slot) and `S7`/`S8` (two) still refuse,
  `NEAR-CLONE` / `NEAR-CLONE RACE` / `S9`/`S10` (identical evidence) and the network scenarios are
  untouched, and a second account on a shared device still receives the machine's *remaining* time —
  the cross-account device-quota contract is unchanged.
- **The band is narrow by construction.** It needs the machine class compared and not contradicted,
  at least four of the six core identity slots agreed *and* at least two of them moved. The fixture  generator's minimum-distance-three design keeps every pair of genuinely different simulated
  machines outside it, which both `FIXTURE ISOLATION` sweeps keep asserting.

Measured after the fix (`NEAR-CLONE QUOTA`, `back-end/src/tests/mining-device.integration.test.ts`):
account A mines and stops with its window spent, then account B — the same simulated machine with two
identity slots edited and a second browser's evidence — is refused `409 mining_quota_exhausted`
(device scope) and holds no active session, while a genuinely different simulated machine in the same
run still starts (`200`). Measured before the fix: that request was `200` with a fresh device window.

### The slot-edit boundary, measured

The binding above closes the band it covers. The obvious next question is what happens just outside it,
so it was measured rather than assumed, by spending one account's device window on a machine (a live
cycle, closed, with its segment backdated to fill all ten hours) and then starting a second account on
the same machine with 1, 2, 3, 4, 5 and 6 of the six engine-stable identity slots edited. The
regression that pins it is `SLOT-EDIT BOUNDARY` in
`back-end/src/tests/mining-device.integration.test.ts`.

| Edited identity slots | Second account's start |
| --- | --- |
| 1 (display gamut) | `409 mining_quota_exhausted` (device scope), no active cycle |
| 2 (gamut + audio device) | `409 mining_quota_exhausted` (device scope), no active cycle |
| 3 (gamut + audio + HDR) | `200`, a **full fresh 10h window** |
| 4 (+ panel colour depth) | `200`, a full fresh 10h window |
| 5 (+ CPU class) | `200`, a full fresh 10h window |
| 6 (+ touch class) | `200`, a full fresh 10h window |
| control: a *different* machine, no edit | `200`, a full fresh 10h window |

So the hole is real, and the last row is why it is not closed here. The fixture generator's design is an
error-detecting certificate whose guarantee is that **every pair of distinct simulated machines differs
in at least three of the six identity slots** — which is exactly what a three-slot edit is. The control
measures the consequence instead of arguing it: a genuinely different machine and a three-slot edit are
*indistinguishable* to the guard (same status, same full window). Binding the allowance at three slots
therefore means binding every pair of distinct machines the two `FIXTURE ISOLATION` sweeps exist to
keep apart — it would not survive without deleting the model's only measured separation guarantee, and
on real hardware it would put unrelated users of the same CPU class onto one 10h allowance. That is a
*worse* failure than the attacker's extra window: it is the customer complaint this whole pass is
about.

The honest position, therefore: the machine allowance binds the machine the guard can recognise as the
same one (identical identity, or the four-agreements-two-moves band). Past that, identity is
client-controlled, and what bounds the rotation is what a fresh allowance costs — the per-account
identity budget (3 new machines/day) and the per-network one. The sixth pass takes that argument one
step further, measures the price of the only rule that would close the three-slot edit, and tightens
the per-network bound to 20 new machines/hour and 40/day; a true close would need a machine identity
the client cannot re-shape (attestation), not another correlation threshold.

## Sixth pass — the three-slot residual, and the bound that replaces it

The fifth pass left one measured hole: an account alternating on one machine is refused the machine's
spent window while the identity still agrees on a majority of the engine-stable slots, but an identity
edited by **three or more** of the six opens a fresh 10h window. The follow-up was whether that can be
closed. It cannot be closed by similarity, and the measurement below is why; what can be closed is the
rate at which one network mints fresh allowances, and that is now the bound.

### The boundary, pinned against the real matcher

The fifth pass measured the boundary end to end through `POST /api/v1/mining/start`. It is now also
pinned against the matching functions themselves, with no HTTP and no database (`SLOT-EDIT BOUNDARY`
in `back-end/src/tests/mining-device.integration.test.ts`), so the boundary is a stated decision
rather than a drift:

| Identity slots edited | Verdict | `score` / `machineScore` | Slots agreeing / moved | Device allowance |
| --- | --- | --- | --- | --- |
| 0 | `same` | 49 / 100 | 6 / 0 | the machine's window (merged) |
| 1 | `same` | 47 / 89 | 5 / 1 | the machine's window (merged) |
| 2 | `ambiguous` | 44 / 67 | 4 / 2 | the machine's window (near-clone band) |
| 3 | `different` | 42 / 56 | 3 / 3 | its own full fresh window |
| 4 | `different` | 32 / 44 | 2 / 4 | its own full fresh window |
| 5 | `different` | 27 / 11 | 1 / 5 | its own full fresh window |
| 6 | `different` | 25 / 0 | 0 / 6 | its own full fresh window |

### Why the remaining gap is not a missed threshold

A rule that caught three edited slots would have to bind the allowance whenever the machine class is
intact and three identity slots still agree. `FIXTURE ISOLATION` now counts what that rule would cost,
with the real matcher, over the fixtures the suite actually sends: **607 of 40,236 pairs of distinct
simulated machines** would be bound to one 10h allowance (2,129 of 58,156 once pristine-variant pairs
are counted too, measured separately). The current near-clone band binds **zero** fixture pairs. That
is not a coincidence: the fixture code's certificate guarantees every cross-index pair differs in at
least three identity slots, which is *exactly* a three-slot edit, so the ambiguity is structural. On
real hardware the same rule would put two unrelated machines of one CPU class and different panels
onto one allowance for a day — a worse failure than the attacker's extra window.

`FIXTURE ISOLATION` therefore now asserts the *allowance* separation as well as the verdict
separation: no fixture pair may share a device window, and the price of widening the band is asserted
next to it so the boundary cannot move without the measurement moving first.

### The bound: a fresh allowance costs a machine identity

The gap is not closable by naming the machine, so it is closed by what a fresh allowance costs. A
**fresh** device allowance always costs a new machine identity — an existing machine returning after
its window closed opens the next window on its own anchor and spends nothing — and a new machine
identity is budgeted per account (3/day) and per network. The per-network budget is therefore the
fixed step between one address and the next fresh allowance, and it is the one control a client cannot
edit away, because it counts identities instead of comparing fingerprints.

It is now tightened to **20 new machine identities per network per hour and 40 per day** (was 40/200).
Measured legitimate demand per address is small and bursty — the suites and the probes mine ten
machines from one address inside one run — so the hour bound keeps a 2x headroom over that, while the
day bound cuts one address from 2,000 possible mining-hours a day to 400, against the 10 hours the
shared device quota intends.

`ENROLL BOUND` pins the whole chain end to end on one private address, using the configured limits:

| Step on one address | Result |
| --- | --- |
| A machine enrolls there (its identity is created) and mines | `200` |
| That address's identity budget is spent with the real budget function | refused on scope `network` at the configured limit (`count` = limit + 1) |
| A **new** machine from a fresh account on that address | `403 mining_device_enrollment_limited` |
| The machine that already enrolled, its window a day old | `200`, a full fresh 10h window |

The last row is the point: the bound bites the multiplication and nothing else. An honest household or
office keeps its machines, because a machine that has enrolled once never spends this budget again.

**What is still open, honestly:** the residual is a *rate*, not zero. One address can still mint 40
fresh allowances on one machine per day by editing three or more slots each time (400 mining-hours
instead of 10), and an attacker who also rotates networks is bounded only by the per-account and the
per-network budgets together. A true close needs a machine identity the client cannot re-shape —
hardware attestation, or a server-issued device key the client must prove possession of per machine —
which is a product decision, not another correlation threshold.

### Refusal reasons as an operational number

Every refusal already carries its machine-readable code, and the fourth pass's per-network counters
made one class of *false* refusal visible only after customers reported it. The reporting surface is a
read-only ops command, not a new endpoint or an admin role: this backend has no administrative
surface at all, and adding one is a product decision rather than an incident fix.

```
MONGODB_DATABASE=<db> npm run ops:mining-refusals:dev -- --hours 24 --limit 25
```

`back-end/src/scripts/mining-refusal-report.ts` groups `security_events` in a time window by
`eventType` / `metadata.reason` / `metadata.scope`, counts the **distinct accounts** behind each group
(one account rejected four hundred times and four hundred accounts rejected once are the same event
count and different incidents), marks the documented start refusals, and prints the plan it used.

**Query analysis before trusting it:** `security_events` indexes only `{ publicId }` and
`{ ownerUserId, createdAt }`, so a global time-window scan is a **COLLSCAN**, and the command prints
that next to the numbers on every run (measured: `plan: ["COLLSCAN"]`). No index was added: the
project's rule is not to add speculative indexes, and the decision belongs with this measured query at
real volume. Measured output on a live integration database (`louma_quota_verify3`, 1h window, taken
mid-suite): 21 events / 20 accounts / 6 grounds, with `! mining_rejected / cycle_active` and
`! mining_rejected / pool_required` marked as refusals.

### Post-commit audit in the mining and transfer paths

The fourth pass fixed "a committed operation reported as an error" in the mining start. This pass
swept both named paths for the shape. Every mining audit write after a commit (start, settle, stop,
and all of `mining-device/*`) already carries the non-fatal `.catch`, and every success event written
*inside* a transaction rolls back with it — nothing to fix there.

One instance remained, in the transfer path. After the commit, `createTransfer` re-read the
transaction to answer with the stored row and threw `Transfer transaction did not commit` when that
read failed or found nothing — turning a transfer that had already moved money into a `500` that a
retry could not distinguish from a failure. The commit is authoritative now
(`back-end/src/modules/transfers/create.ts`): the stored row is still preferred (it is what a replay
returns), the header this call posted inside its own transaction answers when the read cannot confirm
it, and only when *both* are unavailable — a duplicate converged on, and the identifying read failed —
does the call answer the designed retryable `transfer_conflict`, which a retry with the same
idempotency key resolves into the committed transfer.

### The same shape in the account, security and wallet paths (follow-up pass)

A later pass carried the sweep into the paths the first one had only reported. `recordSecurityEvent`
is a bare `insertOne` that throws, so every post-commit call that awaited it without `.catch` could
answer `500 internal_error` for an operation that had already happened:

- **`security/service.ts`** — `two_factor_setup_failed`, `two_factor_enabled`, `two_factor_disabled`,
  `recovery_codes_regenerated`, the sensitive-action event, and `transfer_password_set`/`_changed`.
  `recovery_codes_regenerated` is the worst of them: the old codes are already replaced, so a failing
  audit write meant the caller never received the new ones — a self-inflicted lockout.
- **`auth/service.ts`** — `login`/`login_pending_two_factor`, `login_failed`,
  `login_blocked_wallet_frozen`, `refresh_token_reuse_detected`, `two_factor_login_failed`,
  `session_revoked`, `logout`, `profile_updated` and `password_changed`. The user-visible bug was the
  wrong *code*, not only the wrong status: a refusal that should be `401`/`403` came back as `500`.
  `password_changed` is unretryable — the old password no longer exists once it lands.
- **`wallets/service.ts`** — `wallet_frozen`/`wallet_unfrozen` and `wallet_address_changed` (whose
  30-day cooldown is spent by the time the audit write runs).

Two events stay inside their transaction on purpose (`registration`, and the two-factor login success):
there the rollback *is* the correct outcome, and they are unchanged.

`register` had the identical non-audit shape as `createTransfer`: after its transaction committed it
re-read the user and threw `Registration did not create the account` when that read failed, so an
account that exists was answered `500` and the customer's retry was told `account_exists` — an account
nobody can enter. It now prefers the stored row and falls back to the row the transaction created.

The trailing `getWallet` reads after `setWalletFrozen` and `setCustomAddress` are deliberately left
alone: unlike the audit write, there is no honest value to answer with when the wallet row cannot be
read at all.

Regressions (both fail without the fix — verified by reverting each one and watching them go red):

- `a committed account change survives a failing audit write, so it is never reported as an error`
  injects a failing `security_events` write for the duration of four operations — regenerate recovery
  codes, change the account password, freeze the wallet, disable 2FA — and asserts that all four return
  their success response *and* that their effects really landed (`injected === 4`, so the injection is
  proven to have fired on each write rather than assumed).
- `a registration whose post-commit re-read fails still returns the account it created` fails only the
  `users` lookup by `publicId` during a registration and asserts the account is created, keeps a working
  session and cannot be re-registered.

## Final checks

All listed final checks were run after the last source and test edits:

| Check | Result |
| --- | --- |
| Backend TypeScript typecheck | Passed |
| Frontend TypeScript typecheck | Passed |
| Backend unit suite | 128 passed, 0 failed, 0 skipped |
| Mining-device API integration suite | 28 passed (24 prior + 3 attack/fixture regressions + the `ONBOARD` first-start regression), 0 failed, 0 skipped — full run after the final edits, exit 0 |
| Attack regressions re-run after the final edits | The network-race reproduction (PRIVACY, STALE, A, ATTACK) passes 4/4 after the fixture repairs; the NEAR-CLONE, NEAR-CLONE RACE and FIXTURE ISOLATION regressions pass in the full suite |
| Same-device attack probe (15 scenarios) | Re-run after the final edits: exit 0, zero breaches, every scenario one 200 plus one refusal with exactly one active session; S7 (two edited identity slots, two networks) is `[200, 409] mining_device_already_in_use` |
| First-mining probe (`lmdg-first-mining-probe.ts`, 9 scenarios) | Re-run after the fix: exit 0. F1 a clean first-ever start is admitted (`200`); F4's tenth brand-new user is no longer refused for enrollment churn (enrolled, then `409 mining_device_network_in_use` from the lease-bounded network rule); F6/F7/F9 one device holds one cycle; F2/F3/F5 unchanged and documented |
| Mining API/ledger integration suite | 18 passed (17 prior + 1 fixture-isolation regression), 0 failed, 0 skipped — full run after the final edits, exit 0 |
| Architecture benchmark | Completed (`BENCHMARK_DONE`); the six critical explain plans are IXSCAN with zero examined rows on the empty task-owned database |
| Load benchmark, 2000-cycle waves | Completed; every integrity assertion passed, outcome mix 15,300/15,300 allowed (raw report: [lmdg-load-benchmark-2026-10-05.json](artifacts/lmdg-load-benchmark-2026-10-05.json)) |
| Git whitespace check | Passed |
| Mining-device API integration suite (fifth pass) | 29 passed (28 prior + the `NEAR-CLONE QUOTA` edited-slot regression), 0 failed, 0 skipped — full run after the final edits, exit 0 |
| Mining API/ledger integration suite (fifth pass) | 18 passed, 0 failed, 0 skipped — full run after the final edits, exit 0, including the `cross-account device quota` contract the edited-slot binding must not disturb |
| Transfer security integration suite (fifth pass) | 14 passed, 0 failed, 0 skipped — full run after the post-commit change in `createTransfer`, exit 0 |
| Same-device attack probe re-run (15 scenarios) | Exit 0, zero breaches: `S5`/`S6` one edited identity slot and `S7`/`S8` two edited slots still refused (`mining_device_already_in_use`, and `mining_device_challenge_required` in the racing variants), `S9`/`S10` identical evidence refused, `S13`–`S15` network scenarios unchanged |
| Mining-device API integration suite (sixth pass) | 31 passed (29 prior + the pinned `SLOT-EDIT BOUNDARY` and the end-to-end `ENROLL BOUND`), 0 failed, 0 skipped — full run after the final edits on the tightened per-network budget, exit 0 |
| Mining API/ledger integration suite (sixth pass) | 18 passed, 0 failed, 0 skipped — full run after the tightened per-network budget, exit 0 (the `cross-account device quota` contract and the ledger invariants unchanged) |
| Same-device attack probe re-run (sixth pass) | Exit 0, zero breaches, `S5`–`S10` still refused, `breaches: []` — the tightened identity budget does not disturb any measured refusal |
| First-mining probe re-run (sixth pass) | Exit 0; `F4`'s ten machines on one address still pass under the tightened per-network budget (10 of the 20/hour it now allows) and its refusal is `409 mining_device_network_in_use`, never the enrollment budget; `F2`, `F5`, `F6`–`F9` unchanged |
| Backend unit suite (sixth pass) | 128 passed, 0 failed, 0 skipped — re-run after the sixth-pass edits |
| Architecture benchmark (sixth pass) | `BENCHMARK_DONE`, exit 0; all six critical plans are IXSCAN with 0 documents examined, on a task-owned database whose schema the suite had created |
| Database/account integration suite (sixth pass) | 42 of 43 passed, including both post-commit regressions (`a committed account change survives a failing audit write…`, `a registration whose post-commit re-read fails…`). The single failure is **pre-existing and unrelated**: the custom-address test asserts a handle without the `@` prefix that the current implementation returns with it, in a wallet-address contract neither this pass nor the post-commit work touches |
| Architecture benchmark (fifth pass) | `BENCHMARK_DONE`; the six critical explain plans are `LIMIT > FETCH > IXSCAN` with zero documents and zero keys examined on the emptied task-owned database |
| Ops refusal report (`ops:mining-refusals:dev`) | Ran against a live integration database: 6 grounds / 20 accounts in a 1h window, refusals marked, `plan: ["COLLSCAN"]` reported (documented, no index added) |
| Slot-edit quota boundary (`SLOT-EDIT BOUNDARY`) | Measured: 1–2 edited identity slots are refused `409 mining_quota_exhausted`; 3–6 get a full fresh window — identically to a genuinely different machine at the fixture's minimum distance. Pinned as a deliberate boundary |
| Account/security/wallet post-commit regressions | 2 added (failing audit write across four committed operations; registration with a failing post-commit read). Both verified to fail with the fix reverted (each answered `500 internal_error`), and to pass with it |
| Accounts/security/wallet/database integration suite | 43 passed (41 prior + 2 new), 1 pre-existing failure: `a custom address replaces the receiving address…` expects the wallet `address` without the `@` prefix while `publicWallet` returns `customAddress` as the address — a mismatch between the committed service and the committed test, in no path this pass touched (verified by running it alone and by the diff of `wallets/service.ts`, which is the two `.catch` additions only) |

**The fifth pass ran twice, and the difference matters.** First against the MongoDB SRV development
cluster that `.env.development` now points at (each suite on its own fresh `MONGODB_DATABASE`), where
the `NEAR-CLONE QUOTA` regression, the whole mining-device suite (29/29) and the probe (zero breaches)
all passed — and the mining suite failed exactly one test, `cross-account device quota`, on
`consumedSeconds` `3604 !== 3600`. That is not a code defect and not related to this pass: the test
rewinds a cycle by one hour and then expects an exact `3600`, while `MiningStop` freezes the segment
at the server clock, so the value is one hour *plus the real seconds the two requests took* — one or
two round trips locally, four seconds on the remote cluster. Run in isolation the same failure
reproduced (3604); run against the local replica set the same test passed in 1.9 s with the exact
assertion. Every result reported below is therefore from the local replica set, which is also what
the assertions were written against. The one genuinely environment-bound assertion is left exactly as
it is rather than loosened.

Running the *entire* backend integration set as well (beyond the mining scope) surfaced failures in unrelated suites that reproduce on a fresh task-owned database: a custom-address normalization expectation in `database.integration.test.ts`, and a transfer seed rejected by the transactions validator in `cleanup-test-accounts.integration.test.ts`. Those are not reported as passes and have no mining code in their path. Two further ledger-consistency assertions in the database suite failed only while several suites ran concurrently against one shared database and pass when that suite runs alone.

Integration suites used separate task-owned local databases at `mongodb://127.0.0.1:27017/?replicaSet=rs0`, not customer databases. (The fifth pass ran later, after `.env.development` had been pointed at a MongoDB SRV development cluster: each suite still used its own fresh, isolated `MONGODB_DATABASE` there, and none of them touched a customer database or the local replica set.) Tests cover masked/key-only evidence without a competing cycle, resuming with identifiable evidence after refusal, stale leases, parallel starts, cleared storage, simulated browser/UA/network changes, nonce replay, enrollment limits, account access, the two attacks above, and ledger reconciliation.

Earlier remote runs had failures during connection loss and slow-network timing (including a stop/resume 500 and a timing-sensitive quota assertion). They are not reported as passes. The final complete local reruns passed without skipping tests or weakening assertions. The legacy migration fixture supplies the winning-start observation the migration requires and deliberately gives the device a different latest network, preserving the strong assertion.

The final architecture benchmark ran against a task-owned integration database that the suites had initialized and then emptied (`mining state p50 1.74 ms / p95 3.64 ms`; settings `p50 0.47 ms / p95 0.79 ms`; the six critical explain plans are LIMIT > FETCH > IXSCAN with zero docs and keys examined). An empty database is what the benchmark's own docstring expects after cleanup, so these numbers describe an almost empty database and are **not** evidence of a speedup or a representative production-capacity measurement. Redis was disabled for these checks.

## Load measurement — the decision path under thousands of concurrent cycles

`back-end/src/tests/lmdg-load-benchmark.ts` (test-only; no production code instrumented) drives the
real routes through the real `buildApp` with 2000 accounts, one private 10.x peer address and one
synthetic unique machine per account, and attributes the Mongo work of every request to that request
(`AsyncLocalStorage` over a Proxy around the `Collections`/`MongoClient` the app is handed). Run
2026-10-05 against the task-owned database `louma_load_probe_v4` (local replica set, Redis disabled,
LMDG enforce, network lease lock on, thresholds 78/55, `establishMinAdmissions=3`), then dropped.
Raw report: [lmdg-load-benchmark-2026-10-05.json](artifacts/lmdg-load-benchmark-2026-10-05.json).

Waves (all outcomes HTTP 200 — a population admissible by construction):

| Wave | Requests | Wall | Throughput | p50 | p95 | p99 |
| --- | --- | --- | --- | --- | --- | --- |
| fresh enrollment, 256 in flight | 2000 | 62.0 s | 32.3/s | 8.34 s | 8.58 s | 8.60 s |
| returning stop, 16 in flight | 2000 | 15.0 s | 133.6/s | 30 ms | 457 ms | 1.65 s |
| returning start, 16 in flight | 2000 | 50.3 s | 39.7/s | 402 ms | 440 ms | 476 ms |
| returning stop, 64 in flight | 2000 | 20.1 s | 99.3/s | 63 ms | 3.62 s | 6.92 s |
| returning start, 64 in flight | 2000 | 53.2 s | 37.6/s | 1.72 s | 1.82 s | 1.88 s |
| returning stop, 256 in flight | 2000 | 64.6 s | 31.0/s | 3.49 s | 34.3 s | 53.5 s |
| returning start, 256 in flight | 2000 | 64.8 s | 30.9/s | 8.40 s | 9.03 s | 9.05 s |
| device status, 64 in flight | 500 | 0.72 s | 696.8/s | 91 ms | 107 ms | 111 ms |
| verify: stop / challenge / prove / retry start, 64 in flight | 200 each | 4.17 / 0.62 / 1.09 / 6.94 s | 48.0 / 320.3 / 184.2 / 28.8/s | 481 / 194 / 337 / 2193 ms | 3210 / 214 / 375 / 2352 ms | 3586 / 218 / 385 / 2369 ms |

What the numbers say:

- **The decision cost per request did not grow with concurrency.** A fresh start performed 42.9 Mongo reads, 13 writes, 337 documents scanned and exactly 1 transaction (max = mean) at 256 in flight; a returning start performed 38.9 reads, 8 writes, ~310 documents and 1 transaction at 16, 64 and 256 in flight (max 39/8). No retry amplification, no N+1, no unbounded scan appeared under load.
- **The light paths are cheap and flat.** `GET /api/v1/mining/device/status` is 4 reads / 0 writes / 6 documents and no transaction at 697 req/s; challenge is 4 reads / 2 writes; prove is 6 reads / 6 writes, both without transactions.
- **Throughput saturates on this single local deployment at ~31–40 starts/s** (39.7/s at 16 in flight, 37.6/s at 64, 30.9/s at 256): offered concurrency raised queue time, not work done. The p50 at 256 in flight ≈ 8 s is almost entirely queue wait (2000 submitted / 256 in flight / ~31 per s), not service time; at 16 in flight the same start's p50 is 402 ms. Stops degrade much earlier than starts (p50 3.5 s at 256 in flight) because each is a settlement transaction.
- **Process shape:** peak RSS 952 MB (2000 in-memory accounts with their P-256 keys and evidence), event-loop delay p50 21 ms / p95 45 ms / p99 147 ms / max 1016 ms over the measured waves.
- **State after 15,300 requests:** 2000 active cycles = 2000 accounts still running, max 1 active cycle per account, 6000 active device-lease keys (3 per cycle: device id, machine key, device key hash), 0 sessions without an active device lease, 0 active leases without a running session, 0 active cycles without a device id, 0 negative enrollment-budget rows. The script failed the run on any violation; it reported none.
- A post-load architecture pass on the same populated database completed (`BENCHMARK_DONE`) with **IXSCAN** on every critical query (mining state p50 1.59 ms / p95 2.96 ms; settings p50 0.43 ms), so the load left no index or scan pathology behind.
- The run also hit a real configured boundary: the first attempt with all 2000 accounts joining the Low Pool stopped at exactly 1000 joins with `mining_pool_full` (both pools are configured for 1000 members); the population was split 1000/1000 across Low and Medium. A 2001st miner needs a third room or a capacity change, not a code change.

Honest limits of this measurement:

- `app.inject` is in-process: HTTP parsing, TLS, the network and client-side key generation are outside the numbers; one Node event loop serves all requests, the driver pool is the configured 20 connections, and MongoDB is a single local replica-set node with majority writes. The absolute latency and throughput are properties of this box, **not a production capacity claim**.
- Every wave was admissible by construction (unique device, unique network). These numbers describe the allowed path under load; the refusal path under concurrent contention is not measured here — its correctness (one 200 + one 409 `mining_device_network_in_use`) is the integration-suite regression in the second pass.
- Waves ran in sequence on the same population, so later levels see matured trust state (`establishMinAdmissions=3`) and a larger history than the first wave.
- Redis was disabled, exactly as in the integration suites: cache and distributed-throttle behavior is not represented, and no rate-limited or 5xx outcome was produced (0 of 15,300).

## Deployment and limits

- Deploy both backend enforcement and frontend messages; the local change has not protected a running production server yet.
- Admission guard must be enabled (`LMDG_ENABLED=true`, `LMDG_DEVICE_LEASE_ENABLED=true`) and use an enforcing mode, not `LMDG_RISK_MODE=monitor`.
- This check does not retroactively stop an already admitted mining cycle.
- A blocked graphics collector on an otherwise legitimate computer is intentionally refused mining under the selected policy; its account remains accessible. Enabling device evidence or changing to a browser that exposes it can restore admission, subject to normal lease/quota checks.
- No real Tor binary was tested. Generic/missing-graphics payloads, including Tor-like masked evidence, were tested through the API. Do not equate that with exhaustive Tor verification.
- All browser evidence is client-controlled. A custom API client can fabricate plausible graphics and machine traits; generic-label rejection is not remote hardware attestation. More fingerprint fields or HMACs cannot make such claims trustworthy.
- The pre-existing coarse machine-key correlation can still collide between genuinely different computers with identical reported traits. This work removes stale-lease and unrelated-drift false refusals, but does not guarantee zero false positives.
- The network serialization deliberately covers non-resident starts only, because the policy exempts a cluster that actually mined on that network recently. A fresh identity racing the first commit of a resident's own start can therefore still be admitted when its transaction commits first; both transactions acted on the state each of them committed against, and stopping that interleaving would require removing the resident exemption the policy depends on.
- The sequential account switch is closed for an identity edited by **one or two** engine-stable slots (the near-clone band, now bound to the matched machine's allowance). It is **not** closed for three or more edited slots, and that is measured, not assumed: a three-slot edit and a genuinely different machine at the fixture's minimum distance produce the same start (a full fresh window), so no correlation threshold can separate them — see *The slot-edit boundary, measured* and the sixth pass, which counts what the only candidate rule would cost (607 of 40,236 distinct fixture pairs). What bounds the rotation today is volume: 3 new machines/day/account and **20/hour, 40/day per network** (tightened from 40/200 in the sixth pass, and pinned end to end by `ENROLL BOUND`). Closing the residual itself needs a machine identity the client cannot re-shape.
- Two computers reporting byte-identical traits remain one identity by design, and that fail-closed trade-off is unchanged.
- The post-commit audit now covers the mining, transfer, account, security and wallet paths. The only post-commit reads deliberately left unguarded are the trailing `getWallet` reads after `setWalletFrozen`/`setCustomAddress`, where there is no honest value to answer with if the wallet row cannot be read.
- The thin-evidence correlation path (browser-key-only, no machine traits) is not reachable through `POST /api/v1/mining/start`, which refuses such evidence before device registration; the integration suite exercises the resolution service directly. Its leftover rows are cleaned up by the suite, and no admission rule relies on that correlation.
- One physical machine across every browser/profile, with no trusted device attestation or independent identity control, cannot be guaranteed by a website alone. The verified scope is closing the tested admission and handshake paths, not eliminating every possible multi-account attack.

Browser behavior reference: [Mullvad hard facts](https://mullvad.net/en/browser/hard-facts), which describes fingerprint resistance, common reported values and profile reset behavior.
