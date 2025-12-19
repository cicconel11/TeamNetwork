# Repository Guidelines

## Project Structure & Module Organization
- `src/app/` holds Next.js App Router routes and layouts (for example, `src/app/[orgSlug]/...`).
- `src/components/` contains shared UI and feature components.
- `src/lib/` provides auth helpers and Supabase client wrappers.
- `src/types/` includes generated types like `src/types/database.ts`.
- `supabase/migrations/` stores SQL migrations for schema and RLS.
- `docs/` keeps product and database notes.
- `tests/` contains Node test files.

## Build, Test, and Development Commands
- `npm run dev` runs the local Next.js server at `http://localhost:3000`.
- `npm run build` produces the production build.
- `npm run start` serves the production build after `build`.
- `npm run lint` runs ESLint.
- `npm run test:auth` runs `tests/middleware.testing123.test.ts`.

## Coding Style & Naming Conventions
- TypeScript/React, 2-space indentation, semicolons, and double quotes (match existing files).
- Components use PascalCase; hooks use `useX` naming.
- Next.js route files follow App Router conventions (`page.tsx`, `layout.tsx`).
- Supabase tables/columns stay `snake_case`; keep frontend types in sync with `src/types/database.ts`.
- Prefer the Supabase wrappers in `src/lib/supabase/*` over ad hoc clients.

## Testing Guidelines
- Tests live in `tests/` and use Node's built-in test runner.
- Name new tests `*.test.ts` and focus on auth, middleware, and RLS-sensitive flows.
- Run `npm run test:auth` before PRs that touch session or auth logic.

## Commit & Pull Request Guidelines
- Recent history includes conventional prefixes (e.g., `fix:`) and many terse single-letter commits. Prefer `feat:`, `fix:`, or `chore:` with a short, specific summary.
- PRs should include: a concise description, linked issue (if any), migration notes for `supabase/migrations`, and screenshots for UI changes.
- List the commands you ran (for example, `npm run lint`, `npm run test:auth`).

## Security & Configuration Tips
- `.env.local` contains Supabase keys; never commit secrets.
- `src/lib/supabase/config.ts` asserts the project ref; update it if the project changes.
- After schema changes, add a migration and regenerate types.

## Agent-Specific Instructions
- Use `grep -r` or `rg` (ripgrep) for searching the repository instead of mgrep.
