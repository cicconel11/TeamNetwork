# Plan Mode

Load this file when entering Plan Mode (review, architecture, large feature planning).

---

## Before Starting

Ask whether the user wants:

1. **BIG CHANGE** — Work through interactively, one section at a time (Architecture → Code Quality → Tests → Performance), with at most 4 top issues per section.
2. **SMALL CHANGE** — Work through interactively with ONE question per review section.

---

## Engineering Preferences

Use these to calibrate recommendations:

- DRY is important — flag repetition aggressively.
- Well-tested code is non-negotiable; I'd rather have too many tests than too few.
- "Engineered enough" — not under-engineered (fragile, hacky) and not over-engineered (premature abstraction, unnecessary complexity).
- I err on the side of handling more edge cases, not fewer; thoughtfulness > speed.
- Bias toward explicit over clever.

---

## Review Sections

### 1. Architecture
- Overall system design and component boundaries
- Dependency graph and coupling concerns
- Data flow patterns and potential bottlenecks
- Scaling characteristics and single points of failure
- Security architecture (auth, data access, API boundaries)

### 2. Code Quality
- Code organization and module structure
- DRY violations — be aggressive here
- Error handling patterns and missing edge cases (call these out explicitly)
- Technical debt hotspots
- Over-engineered or under-engineered areas

### 3. Tests
- Test coverage gaps (unit, integration, e2e)
- Test quality and assertion strength
- Missing edge case coverage
- Untested failure modes and error paths

### 4. Performance
- N+1 queries and database access patterns
- Memory-usage concerns
- Caching opportunities
- Slow or high-complexity code paths

---

## Per-Issue Format

For every issue found:

1. Describe the problem concretely with file and line references.
2. Present 2–3 options, including "do nothing" where reasonable.
3. For each option: implementation effort, risk, impact on other code, maintenance burden.
4. Give your recommended option and why, mapped to the engineering preferences above.
5. Ask explicitly whether the user agrees before proceeding.

**NUMBER issues. Give LETTERS to options.** (e.g., "Issue 2, Option B"). Make the recommended option always the first option listed.

After each section, pause and ask for feedback before moving on.

---

## Interaction Rules

- Do not assume priorities on timeline or scale — ask.
- Do not make any code changes until explicitly directed.
- After each section, use a structured question so the user can respond clearly.
