---
status: pending
priority: p1
issue_id: "003"
tags: [ai, performance, latency]
dependencies: []
---

# Agent Latency Optimization Pass

## Problem Statement

Recent AI routing work added broader global lookup coverage and more deterministic fast paths, but future optimization should be selected from aggregate audit telemetry instead of guessed from code inspection alone.

## Findings

- `GET /api/admin/ai/latency-stats?days=1|7|30` now exposes dev-admin aggregate latency buckets over capped `ai_audit_log.stage_timings` scans.
- `stage_timings.request.fast_path_label` now separates suppressors (`draft_active`, `attachment_present`, etc.) from eligible fast paths while preserving the existing `pass1_path` contract.
- Old audit rows without `fast_path_label` bucket as `unclassified`; wait for 2-3 days of real traffic before choosing the next latency PR.
- Current candidate areas remain `get_org_stats` fan-out, `search_org_content` fallback reads, renderer-side post-tool lookups, and broader deterministic pass-1 bypasses, but telemetry should rank them.

## Proposed Solutions

1. Review `/api/admin/ai/latency-stats?days=1` and `?days=7` after real traffic has populated `fast_path_label`.
2. Pick the next speed PR from the slowest high-volume `fast_path_label`, `pass1_path`, stage, or tool bucket with reliable sample size.
3. Prefer changes that preserve the current SSE event sequence, final assistant bytes, tool calls executed, and audit `schema_version: 1`.

## Acceptance Criteria

- [ ] Stage timing audits identify a high-volume bottleneck with `n >= 20` in the relevant bucket.
- [ ] The chosen optimization includes before/after latency evidence from the aggregate endpoint.
- [ ] Any expanded bypass path has regression tests proving parity for SSE event sequence, final assistant bytes, and tool calls executed.
- [ ] Docs in `docs/agent/assistant.md` and `docs/agent/chat-pipeline-codemap.md` remain aligned with the implemented latency path.
