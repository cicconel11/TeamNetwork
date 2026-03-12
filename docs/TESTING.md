# Testing Patterns

**Analysis Date:** 2026-03-11

## Test Framework

- Runner: Node.js built-in test runner (`node:test`)
- Assertions: `node:assert/strict`
- TypeScript loader: `tests/ts-loader.js`
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
- Some older docs and comments still refer to an audit crawler suite, but no `tests/audit/` directory currently exists in the repo.
