# Browser Mining Implementation Plan

**Goal:** Run browser mining with proven key continuity, account step-up before suspicious starts, and atomic reward entitlement.

**Architecture:** MongoDB owns attempts, key leases, quotas, admission receipts and the balanced journal. Browser keys identify browser enrollments; fingerprints and network evidence only affect risk. Strict mode remains an explicit maintenance option; browser mode is the default and cannot disable proof or leases through legacy rollout flags.

**Spec:** User's browser-only request and ADR-018 in `docs/adr.md`.

**Constraints:** No production database access, deployment, commits, pushes, historical deletion or paid service. Retain legacy adversarial witnesses and their OPEN classification. Real-device pilot results must not be inferred from synthetic fixtures.

- [x] Add browser config, intent-bound challenge and exact canonical key identity; verify changed intent, wrong account, expiry, replay and missing proof rejection through real HTTP requests.
- [x] Add indexed bounded risk assessment and password plus enabled 2FA step-up. Shared IP or hardware never create identity conflicts. Verify wrong/correct credentials and same-key concurrent starts.
- [x] Consume proof and create enrollment, admission receipt, session and leases in one transaction; verify rollback and retry. Preserve account and key quota.
- [x] Validate stored admission and permanent lease binding in every reward path; verify duplicate settlement and altered/missing admission cannot credit.
- [x] Implement existing browser proof flow plus inline account verification in Arabic/English; typecheck both apps.
- [x] Run isolated unit, integration, adversarial, architecture and browser scale/load cases; retain raw output and inspect MongoDB state. The scale case completed before its runner was interrupted; the separate load and final full regression runs completed successfully.
- [x] Request independent security review, fix findings, document cutover/rollback and outstanding real-device pilot. Initial review completed; final re-review could not run because of the provider token-rate limit.
- [ ] Before production rollout, exercise the real frontend on physical devices and measure the pilot matrix in `docs/browser-mining-report.md`. Synthetic API tests do not complete this step.

Execution stays in this session. No commit step is authorized.
