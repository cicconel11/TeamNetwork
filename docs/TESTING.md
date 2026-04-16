# Testing Patterns

**Last Updated:** 2026-04-16

## Test Framework

- Runner: Node.js built-in test runner (`node:test`)
- Assertions: `node:assert/strict`
- TypeScript loader: `tests/ts-loader.js` (custom — see [TypeScript loader strategy](#typescript-loader-strategy))
- E2E: Playwright (`@playwright/test`)
- Property-based testing: `fast-check`

## Run Commands

```bash
npm run test
npm run test:unit
npm run test:security
npm run test:payments
npm run test:schedules
npm run test:routes
npm run test:jobs
npm run test:media
npm run test:qrcode
npm run test:e2e
npm run test:e2e:ui
npm run test:e2e:debug
```

Single-file example:

```bash
node --test --loader ./tests/ts-loader.js tests/payment-idempotency.test.ts
```

Enterprise example:

```bash
node --test --loader ./tests/ts-loader.js tests/enterprise/*.test.ts tests/routes/enterprise/*.test.ts
```

## Current Inventory Snapshot

- Total files under `tests/`: 217
- Tests are not colocated with source files
- Route simulation suites live under `tests/routes/`

Current route test directories:

- `admin`
- `analytics`
- `calendar`
- `chat`
- `cron`
- `dev-admin`
- `discussions`
- `enterprise`
- `feed`
- `feedback`
- `jobs`
- `notifications`
- `organizations`
- `schedules`
- `stripe`

## Layout

```text
tests/
├── *.test.ts
├── enterprise/
├── routes/
│   ├── admin/
│   ├── analytics/
│   ├── calendar/
│   ├── chat/
│   ├── cron/
│   ├── dev-admin/
│   ├── discussions/
│   ├── enterprise/
│   ├── feed/
│   ├── feedback/
│   ├── jobs/
│   ├── notifications/
│   ├── organizations/
│   ├── schedules/
│   └── stripe/
├── e2e/
│   ├── auth.setup.ts
│   ├── fixtures/
│   ├── page-objects/
│   └── specs/
├── fixtures/
├── utils/
└── ts-loader.js
```

## Common Patterns

- Unit and integration tests are mostly flat top-level `test()` calls.
- Route tests usually simulate handler behavior directly instead of making real HTTP requests.
- Each test creates fresh state instead of relying on `beforeEach` / `afterEach`.
- `tests/utils/supabaseStub.ts` is the primary in-memory database stub.
- `tests/utils/stripeMock.ts` provides typed Stripe factories.
- `tests/utils/authMock.ts` provides role and auth presets.

## Notes

- `playwright.config.ts` defines `e2e-setup` and `e2e` projects.
- There is no committed `tests/routes/auth/` directory.
- `playwright.config.ts` still references an `audit-crawler` project whose `tests/audit/` suite was removed — running `--project=audit-crawler` will fail. See `docs/audit-setup.md` for the replacement plan.

---

## TypeScript Loader Strategy

Three options, in current order of preference:

1. **Recommended: `tsx` via `--import tsx`** (Node ≥ 20).
   - Zero-config, supports enums / namespaces / parameter properties.
   - Single-file: `node --import tsx --test tests/foo.test.ts`
   - Migration target; allows deleting `tests/ts-loader.js`.
2. **Node built-in type stripping** (`--experimental-strip-types`, default in Node 23.6+).
   - Works for pure type-annotation TS only. No enums, no parameter properties.
   - Not ready as the default path until we retire enums/decorators from test code.
3. **Current: custom `tests/ts-loader.js`**.
   - Hand-rolled. Keeps `@/` path alias resolution and `next/*` extension rewrites.
   - Deferred migration — see the follow-up todo in `docs/agent/todos/`.

## Coverage Reporting

`node:test` has built-in coverage since Node 22.

```bash
node --import tsx --test \
     --experimental-test-coverage \
     --test-reporter=lcov --test-reporter-destination=coverage/lcov.info \
     --enable-source-maps \
     'tests/**/*.test.ts'
```

`--enable-source-maps` is required for correct line numbers under TypeScript. If coverage is flaky or you need consolidated HTML reports, fall back to `c8`:

```bash
npx c8 --reporter=lcov --reporter=html node --import tsx --test 'tests/**/*.test.ts'
```

## Route-Handler Testing

Three options, pick per test:

1. **Direct import** (current default).
   ```ts
   import { POST } from "@/app/api/x/route";
   const res = await POST(new Request("http://localhost/api/x", { … }));
   ```
   Fast, zero deps. **Limitation:** no Next runtime — `cookies()` / `headers()` / `NextResponse.redirect()` won't work without manual shims.
2. **[`next-test-api-route-handler`](https://www.npmjs.com/package/next-test-api-route-handler) (NTARH)**. Emulates Next runtime; use when the handler relies on `cookies()`, redirects, or middleware-dependent behavior.
3. **Supertest + live dev server**. Rare; defer to Playwright E2E for end-to-end coverage.

## Playwright Auth & Roles

- Storage state reuse is already configured via the `e2e-setup` → `e2e` project dependency.
- Per-role storage states (one file per role: admin / active_member / alumni / parent) is the scaling path when role-specific flows grow.
- Verify `playwright/.auth/` is in `.gitignore`. Storage-state JSON contains bearer tokens.
