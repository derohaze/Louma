# Frontend Architecture (Clean Architecture / Feature-Sliced)

`frontend/src` is layered. Dependencies flow **inward only**:

```
routes/  →  app/  →  features/  →  shared/
```

- `routes/` — TanStack file-based routes. Thin: `createFileRoute` + `<WalletPage>` +
  one feature export. No logic here.
- `app/` — composition only: `shell/` (page frame) and `session/` (account loading).
- `features/<name>/` — one business capability each (auth, mining, transfer, …).
- `shared/` — cross-cutting code with no business state: `api/`, `lib/<domain>/`,
  `hooks/`, `ui/`, `skeletons/<area>/`.

**Rules:**

1. `shared/` never imports from `features/`, `app/`, or `routes/`.
2. One feature never imports another feature's internals. Shared code goes in `shared/`.
3. Every folder exposes its public surface through its own `index.ts` barrel.
   Consumers import the **folder path** (`@/features/mining`), never deep files —
   except a feature's own pages, which import their inner segments deep
   (`@/features/mining/cycle/useMiningCycle`) to avoid barrel cycles.
4. Barrels use **relative `./` imports** internally, so automated refactors can
   never turn them into self-imports.
5. `shared/ui/` stays flat (upstream shadcn convention). `routes/` stays flat
   (TanStack convention). Everything else groups by **domain, not file type**.
6. No dead code: unexport-then-delete. If only one module uses a helper, it is
   private (no `export`). Barrel re-exports list only what external callers use.
7. No file over 500 lines (exception: `orb-engine/thinking-orbs.ts`, a verbatim
   third-party port kept whole on purpose).

**Domain folders:**

- `shared/api/{client,auth,session}/` — transport+shapes, sign-in/out, tokens/CSRF.
- `shared/lib/{wallet,security,account,platform}/` — money/nav, security catalog,
  profile/settings, framework plumbing.
- `shared/skeletons/{shell,wallet,transfer,transactions,mining,account}/` —
  loading shapes; the registry in `shared/skeletons/index.ts` is authoritative
  and enforced by `bun run check:skeletons`.
- `features/mining/{page,pools,history,cycle,live,device-guard,orb-engine}/`
- `features/transfer/{page,recipients,send,receive}/`

**Adding a page:** export `<YourPage>Skeleton` in the matching skeletons area,
register its path in `skeletonsByPath`, run `bun run check:skeletons`.
**Adding a feature:** new folder under `features/` + local `index.ts`, routes
import the barrel. **Verification:** `bun run typecheck && bun run lint &&
bun run check:skeletons && bun run build`.
