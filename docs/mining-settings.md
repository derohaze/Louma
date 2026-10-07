# Mining settings (`mining_settings` collection)

Every tunable of the mining system lives in MongoDB — one document per key —
instead of the environment. The env vars (`MINING_*`) are only boot defaults:
any key present in the collection overrides them, a missing key falls back to
its env default, and an invalid stored value is ignored with a warning (mining
keeps running on the default).

Reads are uncached: a change takes effect on the very next mining request, no
restart. There is no customer endpoint for this — only the operator script,
which needs database credentials on the host.

## Keys

| Key | Value shape | Default (env) |
| --- | --- | --- |
| `mining.enabled` | boolean | `MINING_ENABLED` (true) |
| `mining.settlementEnabled` | boolean | `MINING_SETTLEMENT_ENABLED` (true) |
| `mining.rate` | `{ minUnits, maxUnits, scale, decimals }` — exact integer LMA/hour band | `MINING_RATE_*` (0.0100–0.0500, 6 decimals) |
| `mining.pools.low` | `{ baseHashrate, rewardMinBps, rewardMaxBps, maxMembers }` | 100 H, 8500–11500 (0.85–1.15x), 1000 members |
| `mining.pools.medium` | same shape | 100 H, 7000–13000 (0.7–1.3x), 1000 members |

Reward bands are basis points (10000 = 1.0x), capped at 50000 (5.0x). A full
pool refuses joins (`mining_pool_full`) until someone leaves.

## Operator script

```bash
# List stored overrides (empty = everything on env defaults)
npm run mining:settings:dev -- --list

# Cap the Medium room at 50 members, effective immediately
npm run mining:settings:dev -- --set mining.pools.medium --value '{"baseHashrate":100,"rewardMinBps":7000,"rewardMaxBps":13000,"maxMembers":50}'

# Pause mining without a restart
npm run mining:settings:dev -- --set mining.enabled --value 'false'

# Fall back to the env default
npm run mining:settings:dev -- --reset mining.pools.medium
```

Production uses `npm run mining:settings -- ...` (reads `.env.production`).
Invalid values are refused by the script with the reason; if a bad row ever
reaches the collection by hand, reads warn and keep the default.

## Room holds (env-only)

A pool row is a **hold**, not a permanent membership: joining grants the room
for `MINING_POOL_HOLD_SECONDS` (600), a start extends it to the cycle's end,
and a stop or a finished window releases it — being in a room and mining in it
are the same fact. `MINING_POOL_SWITCH_COOLDOWN_SECONDS` (900) bounds how often
an account may change to a *different* room; taking the room already held, or
the one just left, is always free. Both are env-only: they change how long a
stale hold lingers, never the invariant, which is enforced by the live-hold
predicate plus the `expiresAt` TTL index.

## Deliberately NOT in the collection

- **Quota window (24h), daily quota (10h)** and **one active segment per
  account / one active lease per device**: code invariants enforced by the
  ledger math, the unique indexes, and the test suite — moving them would risk
  strandable segments, not add control. See `src/modules/mining/quota.ts`:
  10h of actual mining per anchored 24h window, per account and per shared
  device identity, with stop/resume that never moves the anchors.
- **Room hold and change cooldown** (`MINING_POOL_HOLD_SECONDS`,
  `MINING_POOL_SWITCH_COOLDOWN_SECONDS`): deployment abuse bounds of the
  membership lifecycle above, in env for the same reason as the LMDG
  thresholds — a live-editable hold could stretch a room out from under the
  cycle it belongs to.
- **Device-guard (LMDG) thresholds**: security policy, stays in env.
