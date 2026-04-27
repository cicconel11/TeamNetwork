---
status: pending
priority: p1
issue_id: "003"
tags: [ai, performance, latency]
dependencies: []
---

# Agent Latency Optimization Pass

## Problem Statement

Recent AI routing work added broader global lookup coverage and more deterministic fast paths, but several turns still perform avoidable database reads or model round trips before returning a response.

## Findings

- `get_org_stats` is scoped for narrow questions, but generic snapshot prompts still fan out across members, alumni, parents, events, and donation stats.
- `search_org_content` calls the shared search RPC and then direct announcement/event fallback queries, so content-search turns can perform three database reads.
- Some deterministic `tool_first` renderers perform post-tool lookups such as org slug resolution for chat groups and donor privacy lookup for donations.
- Pass-1 bypass is limited to zero-arg or locally derivable read tools; search/navigation prompts still need the model planner even when query extraction is straightforward.
- `tool_first` prompt context still loads baseline org info instead of reusing already-known auth/org context.

## Proposed Solutions

1. Add a compact stats RPC/materialized view or short-TTL sliced cache for dashboard-style `get_org_stats` snapshots.
2. Fold announcement/event fallback matching into the `search_org_content` RPC, or only run fallback queries when the RPC returns too few relevant rows.
3. Include formatting context (org slug, donor privacy flags) in tool payloads to avoid renderer-side round trips.
4. Extend pass-1 bypass to deterministic search/navigation once local query extraction is covered by routing tests.
5. Make `tool_first` prompt context explicitly minimal and reuse org name/slug from existing request context where possible.

## Acceptance Criteria

- [ ] Stage timing audits show fewer DB reads on common `tool_first` turns.
- [ ] Generic stats prompts avoid full fan-out or use a cached/materialized aggregate.
- [ ] Content search does not perform fallback reads when the RPC result is already sufficient.
- [ ] Search/navigation bypass candidates have regression tests proving extracted args match model-planned args.
- [ ] Docs in `docs/agent/assistant.md` and `docs/agent/chat-pipeline-codemap.md` remain aligned with the implemented latency path.
