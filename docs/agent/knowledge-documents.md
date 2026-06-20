---
type: data-flow
title: Knowledge Documents — RAG Source and Audience Gating
description: The admin-curated knowledge_documents table as the 8th RAG source — its embedding pipeline, both retrieval paths, and the broad-only keyword gate (D1).
resource: apps/web/src/lib/ai/chunker.ts
tags: [ai, rag, knowledge, audience, security]
timestamp: 2026-06-19T00:00:00Z
---

# Knowledge Documents — RAG Source and Audience Gating

## Summary

`knowledge_documents` is an admin-curated, org-scoped knowledge base — handbook entries, FAQs, policies, and reference docs an admin wants the assistant to ground on. It is the **8th RAG source**, alongside the seven content sources already indexed for retrieval (`announcements`, `discussion_threads`, `discussion_replies`, `events`, `job_postings`, `mentor_profiles`, `form_submissions`). Migration `20261224000000_knowledge_documents.sql` creates the table; `renderKnowledgeDocument` in `apps/web/src/lib/ai/chunker.ts` turns rows into embeddable chunks.

Unlike the other sources, knowledge documents carry a first-class **audience** column that gates who may retrieve them. The security-critical property: the two retrieval paths expose different audiences, and the keyword path is deliberately the narrower of the two (decision **D1**).

## The RAG Source List

| Source table | Renderer (`chunker.ts`) |
|---|---|
| `announcements` | `renderAnnouncement` |
| `discussion_threads` | `renderDiscussionThread` |
| `discussion_replies` | `renderDiscussionReply` (parent thread context injected; short replies skipped) |
| `events` | `renderEvent` |
| `job_postings` | `renderJobPosting` |
| `mentor_profiles` | `renderMentorProfile` |
| `form_submissions` | `renderFormSubmission` |
| `knowledge_documents` | `renderKnowledgeDocument` |

The `ai_document_chunks.source_table` CHECK constraint enumerates all eight; the `20261224000000` migration rebuilds it idempotently to include `knowledge_documents`.

## Ingestion Pipeline

Knowledge documents flow through the same source-agnostic embedding pipeline as every other source — no bespoke ingestion path:

```
INSERT/UPDATE knowledge_documents
  → trg_ai_embed_knowledge_documents (AFTER INSERT OR UPDATE)
  → enqueue_ai_embedding()           — enqueues only when indexed content changed
  → ai_embedding_queue               — { org_id, source_table, source_id, action }
  → embedding-worker                 — drains the queue, renders chunks, embeds
  → ai_document_chunks               — chunk text + vector + metadata, org-scoped
```

- The `enqueue_ai_embedding()` trigger has a `knowledge_documents` change-detection branch: it skips no-op UPDATEs and only re-enqueues when `title`, `body`, `description`, `type`, `tags`, or `audience` actually change. Soft-deletes (`deleted_at` set) enqueue a `delete` action.
- `backfill_ai_embedding_queue(p_org_id)` includes a `knowledge_documents` scan block so existing rows can be indexed on demand, alongside the other indexed sources.
- `renderKnowledgeDocument` builds chunk text from `title`, `type`, `tags`, `description`, and `body`, and carries `{ title, type, tags, audience }` into chunk metadata. The `audience` token is **always** written to metadata (defaulting to `"all"`) so the vector search RPC can filter on `metadata->>'audience'`.

## Audience Semantics

A single token gates visibility, shared across both the table column and chunk metadata:

| Token | Visibility |
|---|---|
| `all` (default) / `both` / unset | Every role — broad |
| `admins` | Admin-only |

The `audience` column is constrained to a fixed token allowlist (`all`, `both`, `members`, `active_members`, `alumni`, `admins`) so retrieval gating cannot be broken by an arbitrary free-text value. Non-admin roles map to allowlists via `audienceFilterForRole()` in `apps/web/src/lib/ai/rag-retriever.ts` (e.g. `active_member` → `["members", "active_members"]`, `alumni` / `parent` → `["alumni"]`). The `admins` token appears in **no** non-admin allowlist, so only admins — who pass `undefined` (no filter) — can ever retrieve an `admins`-restricted document. Broad tokens (`all` / `both` / unset) are visible regardless of the allowlist.

## Two Retrieval Paths

### 1. Vector path (role-gated) — `search_ai_documents`

The semantic-similarity path. `retrieveRelevantChunks` in `rag-retriever.ts` calls the `search_ai_documents` RPC, passing `p_audience_filter` derived from `audienceFilterForRole(role)`. Admins pass a NULL filter and see everything, including `audience='admins'` docs; non-admins see only documents whose audience is in their allowlist or is broad. This is the **only** route to `admins`-restricted knowledge.

### 2. Keyword path (broad-only, D1) — `search_org_content`

The lexical/trigram path that also powers the global search bar and the `search_org_content` assistant tool. It is **broad-only by design (decision D1)**: it returns ONLY documents where `COALESCE(audience, 'all') IN ('all', 'both')`.

The gate is enforced in two mirrored places, so neither can drift open alone:

- **SQL:** the `knowledge_rows` CTE in `search_org_content` (migration `20261225000000_search_org_content_knowledge.sql`) filters `COALESCE(kd.audience, 'all') IN ('all', 'both')`.
- **TS fallback:** the direct knowledge read in `apps/web/src/lib/ai/tools/registry/search-org-content.ts` filters `.in("audience", ["all", "both"])`.

**Security invariant (D1):** `audience='admins'` documents are **never** keyword-visible to anyone — not even admins. Admins reach restricted knowledge exclusively through the role-gated vector path. This is safe-by-default: the keyword path is the broader-blast-radius surface (it backs global search and a tool callable by `admin`, `active_member`, and `alumni`), so it is held to the narrowest audience rather than trying to re-derive per-role gating there.

## Access Control and Storage

- **RLS:** `knowledge_documents` is admin-managed — the `knowledge_documents_admin` policy gates all operations on `has_active_role(organization_id, ['admin'])`. Members never read or write the table directly; they only see its content through retrieval, subject to the audience gate above.
- **Org scoping:** every row, chunk, queue entry, and RPC call is org-scoped; cross-org leakage is not possible through either path.
- **Delete cleanup:** a soft delete (`deleted_at` set) enqueues a `delete` action and excludes the row from both retrieval paths; an `AFTER DELETE` trigger enqueues the same cleanup for hard deletes, so admin removals never leave orphaned, still-searchable chunks in `ai_document_chunks`.
- Chunked knowledge content lives in `ai_document_chunks` (vector embeddings) and is retained until re-indexed or org deletion, like every other RAG source — see [AI Data Flow — Privacy and Compliance](/docs/agent/ai-data-flow.md).
