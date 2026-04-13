# AI Data Flow — Privacy & Compliance Documentation

**Last Updated:** April 2026

---

## 1. Overview

The AI assistant is an admin-only, org-scoped chat feature. This document describes what PII enters the AI pipeline, what is stored, what is sent to external APIs, and the retention/access controls in place.

---

## 2. Data Flow Diagram

```
Admin User → Chat Panel (client)
  → POST /api/ai/chat (validated by Zod, admin role required)
    → Context Builder (queries org data via RLS)
    → Semantic Cache Check (exact hash of prompt)
      → Cache HIT: return cached response (no external API call)
      → Cache MISS:
        → RAG Retrieval (embeddings from ai_document_chunks)
        → LLM API Call (z.ai / glm-5 model)
        → Response streamed via SSE
    → Message persisted to ai_messages
    → Audit log entry written to ai_audit_log
```

---

## 3. PII in the Pipeline

### 3.1 What Enters the Pipeline

| Data | Source | Purpose |
|---|---|---|
| Admin's prompt text | User input | The question being asked |
| Org member names | `members` table (via context builder) | Grounding LLM responses in real org data |
| Org member emails | `users` table | Member identification when names are missing |
| Event titles/descriptions | `events` table | Calendar context for scheduling questions |
| Organization metadata | `organizations` table | Org name, settings, member counts |

### 3.2 What is Sent to External API

The LLM prompt sent to z.ai includes:
- System prompt (static template, no PII)
- Org context summary (member counts, org name — aggregated, not individual PII)
- RAG chunks (may contain member names if relevant to the query)
- User's prompt text
- Conversation history from the current thread

**Not sent:** Raw database rows, passwords, email addresses (unless in conversation history), payment data, or data from other organizations.

### 3.3 What is Stored

| Table | Data Stored | Retention |
|---|---|---|
| `ai_threads` | Thread metadata (user_id, org_id, surface, title) | Until user deletes or account deletion cascade |
| `ai_messages` | Full prompt and response text | Until thread deletion or account deletion cascade |
| `ai_audit_log` | Request metadata: user_id, org_id, latency_ms, token counts, cache status, model | Service-role only; no retention purge currently |
| `ai_semantic_cache` | Hashed prompt + cached response text | 12-hour TTL, purged by hourly cron |
| `ai_document_chunks` | Chunked org content with vector embeddings | Until re-indexed or org deletion |

---

## 4. Access Controls

- **Admin-only:** Only users with the `admin` role in an organization can use the AI chat
- **Org-scoped RLS:** All AI tables enforce organization scoping via RLS policies
- **Thread ownership:** Users can only read/write their own threads (enforced by RLS on `ai_threads` and composite FK on `ai_messages`)
- **Audit logging:** Every AI request is logged to `ai_audit_log` (service-role only table)

---

## 5. Admin Exclusion Controls

Admins can exclude specific content from the AI indexing pipeline:

- **Table:** `ai_indexing_exclusions`
- **Mechanism:** Admins mark content types or specific records as excluded
- **Effect:** Excluded content is not chunked, embedded, or included in RAG retrieval
- **Audit:** The `excluded_by` column tracks which admin created each exclusion (SET NULL on user deletion to preserve the record)

---

## 6. Data Export

AI conversation data is included in the FERPA-compliant data export (`GET /api/user/export-data`):

- `aiConversations`: All threads owned by the user, with all messages per thread
- Fields exported: thread ID, message ID, role, content, created_at

---

## 7. Data Deletion

When a user account is deleted:

1. `auth.users` row is deleted via `auth.admin.deleteUser()`
2. `ai_threads` rows cascade-delete (FK to `auth.users` with ON DELETE CASCADE)
3. `ai_messages` rows cascade-delete (FK to `ai_threads`)
4. `ai_audit_log` entries persist with `user_id` set to NULL (audit trail survives deletion)
5. `ai_indexing_exclusions.excluded_by` set to NULL (exclusion record survives)

---

## 8. External API Provider

| Property | Value |
|---|---|
| Provider | z.ai |
| Model | glm-5 |
| API format | OpenAI-compatible |
| Data retention by provider | Per z.ai terms of service |
| Encryption in transit | TLS 1.2+ |

**Note:** No education records (grades, transcripts, attendance) are sent to the external API. The AI context is limited to org membership data, event scheduling, and admin-provided prompts.
