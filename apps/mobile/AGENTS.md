# Repository Guidelines

## Project Structure & Module Organization
- `src/app/` contains Next.js App Router routes and layouts (ex: `src/app/[orgSlug]/page.tsx`).
- `src/components/` holds shared UI and feature components.
- `src/lib/` provides auth helpers and Supabase client wrappers.
- `src/types/` includes generated types (ex: `src/types/database.ts`).
- `supabase/migrations/` stores SQL migrations for schema and RLS.
- `tests/` contains Node test files.
- `docs/` keeps product and database notes.

## Build, Test, and Development Commands
- `npm run dev`: start the local Next.js server at `http://localhost:3000`.
- `npm run build`: create a production build.
- `npm run start`: serve the production build after `build`.
- `npm run lint`: run ESLint for code quality checks.
- `npm run test:auth`: run `tests/middleware.testing123.test.ts`.

## Coding Style & Naming Conventions
- TypeScript/React with 2-space indentation, semicolons, and double quotes.
- Components use PascalCase; hooks use `useX` naming.
- Next.js routes follow App Router conventions (`page.tsx`, `layout.tsx`).
- Supabase tables/columns stay `snake_case`; keep frontend types in sync with `src/types/database.ts`.
- Prefer wrappers in `src/lib/supabase/*` over ad hoc clients.

## Testing Guidelines
- Tests use Node’s built-in test runner.
- Name new tests `*.test.ts` and focus on auth, middleware, and RLS-sensitive flows.
- Run `npm run test:auth` before PRs that touch session or auth logic.

## Commit & Pull Request Guidelines
- Use concise, conventional prefixes like `feat:`, `fix:`, or `chore:`.
- PRs should include: summary, linked issue (if any), migration notes for `supabase/migrations`, and screenshots for UI changes.
- List the commands you ran (ex: `npm run lint`, `npm run test:auth`).

## Security & Configuration Tips
- `.env.local` contains Supabase keys; never commit secrets.
- `src/lib/supabase/config.ts` asserts the project ref; update it if the project changes.
- After schema changes, add a migration and regenerate types.

## Agent-Specific Instructions
- Use `rg` (ripgrep) or `grep -r` for repository searches.
