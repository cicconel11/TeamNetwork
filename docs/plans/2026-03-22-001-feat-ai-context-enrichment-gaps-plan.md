---
title: "feat: AI Context Enrichment — Dynamic Selection, Token Budget, Relevance Filtering"
type: feat
status: active
date: 2026-03-22
---

# feat: AI Context Enrichment — Dynamic Selection, Token Budget, Relevance Filtering

## Overview

Close three gaps in the AI assistant's context builder to reduce wasted tokens, unnecessary DB queries, and improve response relevance by making context loading surface-aware, token-budgeted, and relevance-filtered.

## Problem Statement

The context builder (`src/lib/ai/context-builder.ts`) loads **all 8 data sources** on every request regardless of what the user asked about. The `surface` parameter (general|members|analytics|events) exists on threads but isn't plumbed to context building. There's no token budgeting or relevance filtering — the context message grows unbounded, sending irrelevant data to the model.

## Proposed Solution

Three-phase approach, each building on the previous:

### Phase 1: Surface-Based Context Selection
- Gate data source queries by `surface` using a mapping (surface → required data sources)
- `general` loads all 8 (backward-compatible), `events` only loads org + events, etc.
- Plumb `surface` from handler to context builder

### Phase 2: Token Budget & Metadata
- Enforce ~4000 token budget on context message via character-based estimation
- Prioritize sections (Org Overview highest, Donations lowest)
- Drop entire sections when budget exceeded, starting with lowest priority
- Return `ContextMetadata` for audit/debugging

### Phase 3: Relevance Filtering
- Keyword-based scoring deprioritizes sections unrelated to user's message
- Conservative: only affects ordering when budget is tight
- Org Overview and Current User always full priority

## Technical Considerations

- **Backward compatibility**: Default surface is `general` (loads everything). Wrapper functions (`buildSystemPrompt`, `buildUntrustedOrgContextMessage`) unchanged.
- **Token estimation**: 1 token ~ 4 chars (standard English). No external tokenizer dependency.
- **No partial truncation**: Entire sections included or dropped for coherent output.
- **Cache alignment**: Surface-based context selection aligns with existing surface-based cache TTLs.

## Acceptance Criteria

- [ ] `buildPromptContext` accepts `surface` and only queries relevant data sources
- [ ] Events surface skips member counts, announcements, donations queries
- [ ] Members surface skips events and donations queries
- [ ] Missing `surface` defaults to `general` (all sources) — no breaking change
- [ ] Context message respects 4000-token budget, dropping low-priority sections first
- [ ] `buildPromptContext` returns `ContextMetadata` with included/excluded sections
- [ ] Handler passes surface and metadata to audit log
- [ ] Optional `userMessage` enables keyword-based relevance deprioritization
- [ ] All existing tests in `tests/ai-context-builder.test.ts` pass unchanged
- [ ] New tests cover surface selection, budget enforcement, relevance filtering, metadata

## Files to Modify

| File | Changes |
|------|---------|
| `src/lib/ai/context-builder.ts` | Surface selection, token budget, relevance filtering, metadata return |
| `src/app/api/ai/[orgId]/chat/handler.ts` | Pass surface + userMessage, consume metadata |
| `src/lib/ai/audit.ts` | Optional context metadata fields on AuditEntry |
| `tests/ai-context-builder.test.ts` | New tests for all three gaps |

## Sources

- AI architecture playground: `docs/agents/ai-architecture-playground.html`
- Semantic cache design: `docs/plans/2026-03-21-001-feat-ai-semantic-cache-foundation-plan.md`
- CacheSurface type: `src/lib/ai/semantic-cache-utils.ts:8`
