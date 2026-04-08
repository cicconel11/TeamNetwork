---
review_agents:
  - compound-engineering:review:security-sentinel
  - compound-engineering:review:performance-oracle
  - compound-engineering:review:architecture-strategist
  - compound-engineering:review:kieran-typescript-reviewer
  - compound-engineering:review:data-integrity-guardian
---

This is a Next.js 14 App Router TypeScript SaaS application (TeamMeet).
Multi-tenant — every data access must be scoped to the authenticated user and org.
Supabase PostgreSQL with RLS policies.
New features must use provider-agnostic patterns (google/outlook both supported).
