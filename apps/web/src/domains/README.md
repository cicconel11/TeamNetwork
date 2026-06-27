# `src/domains` — product domains (web app)

Each product domain co-locates everything it owns in one folder, instead of
scattering a feature across `components/`, `lib/`, `lib/schemas/`, and
`lib/ai/tools/`. A domain owns its **database queries, server actions, validation
schemas, UI components, background-job logic, and permission checks**.

```
domains/<domain>/
  components/   # domain UI
  server/       # queries + mutations + server actions + permission checks
  schemas.ts    # Zod validation (when cleanly isolatable from the shared barrel)
  index.ts      # public barrel — the ONLY entry other code should import
  README.md     # what this domain owns
```

## Convention

- Code **outside** a domain imports only from `@/domains/<domain>` (the barrel),
  never from deep paths like `@/domains/<domain>/server/...`.
- Inside a domain, files may import each other with relative paths.
- The barrel resolves through the existing `@/*` → `./src/*` alias — no
  `tsconfig` change is required.

## What stays out of `domains/`

- **`src/app/`** — Next.js App Router routes must live here. Routes are a thin
  layer that imports from domains.
- **`src/components/`** — only shared/generic UI (`ui/`, `shared/`, `layout/`,
  `skeletons/`, `icons/`, `theme/`).
- **`src/lib/`** — cross-cutting infrastructure (`supabase/`, `crypto/`, `utils/`,
  `auth/`, `api/`, `calendar/`, `analytics/`, `payments/`, …).
- **AI tool definitions** — stay in the central `@/lib/ai/tools/registry`; they
  consume domains via their barrels.

## Migration status

This is an incremental migration. Domains are moved in their own branches,
~12 files per phase, with `typecheck` + `lint` + `build` verified between phases.

| Domain          | Status      |
| --------------- | ----------- |
| announcements   | ✅ migrated |
| events          | ✅ migrated |
| jobs            | ✅ migrated |
| _all others_    | ⏳ pending — directory, linkedin, mentorship, fundraising, forms, ai-assistant, members, profiles, organizations, auth, admin, billing |
