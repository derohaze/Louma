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

## Deliberately NOT in the collection

- **Cycle length (24h)** and **one active cycle per account**: code invariants
  enforced by the ledger math, the unique index, and the test suite — moving
  them would risk strandable cycles, not add control.
- **Device-guard (LMDG) thresholds**: security policy, stays in env.
