# Backend Architecture (Clean Architecture / Feature Modules)

`back-end/src` is layered. Dependencies flow **inward only**:

```
server.ts → app.ts → modules/http → modules/<feature> → shared/ + infrastructure/
```

- `server.ts` — process entry: config, Mongo connect, indexes, listen, shutdown.
- `app.ts` — Fastify composition only: plugins, auth decorator, error envelope, hooks.
- `modules/http/` — transport only, no business logic: `routes/` (one group per
  capability), `schemas.ts` (zod shapes), `http-helpers.ts` (cookies, auth guards).
- `modules/<feature>/` — one business capability each
  (`auth`, `mining`, `mining-device`, `transfers`, `security`, `wallets`, `ledger`,
  `geo`, `financial-controls`).
- `shared/` — cross-cutting code with no business state: `errors.ts`, `types.ts`
  (barrel → `types/`), `mongo-retry.ts` (transient/duplicate-key helpers).
- `infrastructure/mongodb/` — driver, collections, validators, schemas, backfills,
  index definitions, indexes (composer).
- `config/` — env parsing + logger. `scripts/` — ops CLIs. `tests/` — integration +
  harnesses (DB-gated, not part of `bun run test`).

## Rules (mirror `docs/frontend-architecture.md`)

1. `shared/` never imports from `modules/`, `app.ts`, or `server.ts`.
2. HTTP layer holds no business logic — it parses, calls one service, returns.
3. One feature never imports another feature's internals, except the single
   documented orchestration edge: `transfers → mining.settleMiningForOwner`
   (balance must reflect accrued mining before spending). No other cross-feature
   imports; `mining → mining-device` is guard calls through its public service.
4. No per-request dynamic `import()` — all module imports are static at top level.
5. No dead code: `src/tests/tmp-orphan-audit.ts` (one-off forensic script, header
   said "Deleted after use") was deleted.
6. Retry/duplication helpers live once in `shared/mongo-retry.ts`
   (`isTransientTransactionError`, `isDuplicateKeyError`, `isUnknownCommitOutcome`,
   `sleep`, `RETRY_BACKOFF_BASE_MS`) — `mining`, `transfers`, and
   `mining-device/repository` all reuse it.
7. Password change lives in `modules/auth/service.ts:changePassword` (verify →
   conditional hash update → revoke siblings → audit), not inline in a route.

## Refactor log (all steps verified `typecheck + test(109) + build` green)

### P0 — performance & architectural fixes

- `shared/mongo-retry.ts` extracted; `mining/service`, `transfers/service`,
  and `mining-device/repository` rewired to reuse it (repository re-exports
  for compat). One source of truth for transient/duplicate-key helpers.
- All per-request dynamic `import()` eliminated — `pools` and `argon2` in
  routes became static imports; `guard`/`signals`/`identity` in
  `mining/service` became static. No import cycle exists
  (`mining-device` never imports `mining`).
- Password-change logic moved from inline in the `/auth/password` route to
  `auth/service.ts:changePassword` — HTTP layer is thin.
- `src/tests/tmp-orphan-audit.ts` (one-off forensic script, header said
  "Deleted after use") deleted.

### P1 — service & module splits

- `modules/http/routes.ts` (512 → 25 lines): composer that delegates to
  `routes/{auth,mining,mining-device,transfers,security,account,notifications}.ts`,
  each one capability. `schemas.ts` + `http-helpers.ts` hold the zod shapes
  and shared cookie/guard helpers.
- `mining-device/service.ts` (1810 → barrel): split into `ip-intel`,
  `resolution`, `credit`, `proof`, `admission`, `lease`, `observation`.
  `service.ts` is now a re-export barrel.
- `mining/service.ts` (948 → barrel): split into `state`, `start`, `settle`,
  `history`. `service.ts` is a barrel.
- `transfers/service.ts` (853 → barrel): split into `intent`, `preview`,
  `create`, `queries`. `service.ts` is a barrel.
- `shared/types.ts` (760 → barrel): split into `types/money`,
  `types/auth`, `types/wallet-ledger`, `types/mining`, `types/device`,
  `types/transfers`. `types.ts` is a re-export barrel — all existing
  `../../shared/types.js` imports keep working.
- `infrastructure/mongodb/indexes.ts` (846 → 98 lines): `schemas.ts`
  (collection JSON-schema validators), `backfills.ts` (bounded migration
  backfills), `definitions.ts` (index creation + drop helpers),
  `validators.ts` (collMod/createCollection), `indexes.ts` (composer with
  retention TTL logic).

### Current file-size status (non-test, non-harness)

Largest files remaining: `mining-device/identity.ts` (697, pre-existing,
not in split scope), `mining-device/admission.ts` (511, single cohesive
`assessMiningStart` function whose inner `findBoundProof` closure cannot be
extracted without adding parameter plumbing), `config/env.ts` (497).
No file exceeds 500 lines except the pre-existing `lmdg-attack-harness.ts`
(1736, verbatim third-party port, exempt) and integration test files (DB-gated).

## Verification

`bun run typecheck && bun run test && bun run build`
(unit tests need no DB; `test:integration*` need one).
