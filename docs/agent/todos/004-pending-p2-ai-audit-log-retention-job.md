---
status: pending
priority: p2
issue_id: "004"
tags: [ai, audit, retention]
dependencies: []
---

# AI Audit Log Retention Job

## Problem Statement

`ai_audit_log` has an `expires_at` column, but there is no documented purge job in the AI pipeline. The column is currently decorative for AI audit volume control, so request telemetry can grow without bound.

## Acceptance Criteria

- [ ] Add or document the production retention job for expired `ai_audit_log` rows.
- [ ] Align `docs/db/schema-audit.md` and `docs/agent/ai-data-flow.md` on the actual retention behavior.
- [ ] Verify the job preserves service-role-only access and does not expose audit rows to user-scoped RLS.
