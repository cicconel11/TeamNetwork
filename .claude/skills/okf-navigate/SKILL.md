---
name: okf-navigate
description: Navigate the repo's OKF knowledge bundles — read docs/agent/index.md and docs/db/okf/index.md, filter docs by type/tags for the task, follow resource: to jump to code. Use when you need to find the right schema table, AI module, or source file for a task instead of grepping blind.
---

# OKF navigate

The repo ships **OKF (Open Knowledge Format) bundles** — directories of markdown
docs, each with YAML frontmatter, cross-linked into a graph. Two bundles exist:

- `docs/agent/` — the AI/assistant knowledge bundle (start at `docs/agent/index.md`).
- `docs/db/okf/` — the database schema bundle: one `db-table` doc per Postgres
  table, generated from `apps/web/src/types/database.ts` by
  `scripts/generate-db-okf.mjs` (`bun run gen:db-okf`).

Each doc's frontmatter carries: `type` (e.g. `index`, `db-table`), `title`,
`description`, `resource` (the source file the doc describes), `tags`, and
`timestamp`. Use this metadata as a navigation index instead of grepping blind.

## How to navigate

1. **Read the bundle indexes first.** Open `docs/agent/index.md` and
   `docs/db/okf/index.md`. The index `type: index` doc lists every doc in its
   bundle with a one-line summary — this is your table of contents.

2. **Filter docs by `type` and `tags` relevant to the task.**
   - Schema / data-model question → `docs/db/okf/`, `type: db-table`. Narrow by
     `tags` (e.g. `ai`, `mentorship`, `chat`, `linkedin`) to the domain.
   - AI / assistant question → `docs/agent/`. Filter by its tags.
   - You do not need to read every doc — pick the few whose `title`/`tags`/
     `description` match the task.

3. **Follow each doc's `resource:` field to jump straight to the code.** The
   `resource` value is a repo-relative source path (e.g.
   `/apps/web/src/types/database.ts`). Open that file directly rather than
   searching for where a table or module is defined.

4. **Use the markdown cross-links as a graph to traverse related concepts.**
   In a `db-table` doc, the `## Related tables` section links to the docs of the
   tables it references via foreign keys (`[organizations](./organizations.md)`).
   Follow those links to walk the schema graph — e.g. from `chat_group_members`
   to `chat_groups`, `organizations`, and `users` — to understand how data is
   joined before you write a query or a migration. FK targets that are database
   views are listed as plain text (not links) so you never chase a dangling ref.

## When to use this

- "Which table stores X?" → filter `docs/db/okf/` by tag, read the matching doc,
  follow its `resource:` and related-table links.
- "Where is the assistant's Y handled?" → start at `docs/agent/index.md`.
- Before writing a Supabase query or a migration, traverse the related-table
  links to map the foreign-key neighborhood of the tables you touch.

The bundles are committed artifacts; if `docs/db/okf/` looks stale or empty,
regenerate it with `bun run gen:db-okf` (deterministic, build-time only).
