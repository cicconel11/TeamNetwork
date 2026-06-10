# AI Data Flow — Privacy & Compliance Documentation

**Last Updated:** June 2026

---

## 1. Overview

The AI assistant is an org-scoped chat feature, currently **admin-only in production** (member access exists behind the `AI_MEMBER_ACCESS_KILL` switch, default on — see §4). This document describes what PII enters the AI pipeline, what is stored, what is sent to the external LLM provider (z.ai), and the retention/access controls in place.

This document describes **shipped behavior**, including the parts that send PII to the external provider. Earlier revisions understated §3.2; do not regress it to aspirational claims.

---

## 2. Data Flow Diagram

```
User → Chat Panel (client)
  → POST /api/ai/chat (validated by Zod; role-gated, see §4)
    → Context Builder (queries org data via RLS)
    → Semantic Cache Check (exact hash of prompt)
      → Cache HIT: return cached response (no external API call)
      → Cache MISS:
        → Pass 1: LLM call (z.ai) — may select tools
        → Tool execution (service-role client for admins;
          RLS-bound client for non-admins on read tools)
        → EITHER deterministic template render (single-tool answers;
          no second LLM call, skips the grounding self-check)
        → OR Pass 2: LLM call (z.ai) with FULL TOOL RESULT JSON
          → deterministic grounding check on the model's prose
        → Response streamed via SSE
    → Message persisted to ai_messages
    → Audit log entry written to ai_audit_log
```

---

## 3. PII in the Pipeline

### 3.1 What Enters the Pipeline

| Data | Source | Purpose |
|---|---|---|
| User's prompt text | User input | The question being asked |
| Org member names | `members` / `users` tables (context builder, tools) | Grounding LLM responses in real org data |
| Org member emails | `users` table (tools) | Member identification when names are missing |
| LinkedIn-enriched profile data | `alumni` / `members` (headline, summary, skills, work history, linkedin_url) | Mentorship matching, directory answers, bio generation |
| Donation rows | `donations` (donor name/email/amount unless org hides donor names) | Donation analytics and listing tools |
| Event titles/descriptions | `events` table | Calendar context for scheduling questions |
| Mentee goals free text | `mentee_preferences.goals` | Mentorship signal extraction |
| Organization metadata | `organizations` table | Org name, settings, member counts |

### 3.2 What is Sent to the External API (z.ai)

**Pass 1** (tool selection) sends:
- System prompt (static template, no PII)
- Org context summary (member counts, org name)
- RAG chunks (may contain member names and content excerpts)
- User's prompt text and conversation history for the thread

**Pass 2** (response composition) additionally sends the **complete JSON output of every executed tool** (`response-composer.ts` serializes `toolResult.data` verbatim into the tool message). Depending on the tools invoked, this includes:
- Member **names and emails** (`list_members`; `list_member_preferences` sends emails for admin actors — non-admin actors receive `email: null` before serialization)
- **LinkedIn-derived fields**: `linkedin_url`, headline, summary, skills, work history, company, industry
- **Donor names, emails, and amounts** (`list_donations`, unless the org enables `hide_donor_names`)
- Mentorship suggestion payloads (names, match reasons, confidence scores)

**Deterministic path:** single-tool questions matching a known shape are rendered from a server-side template without a Pass-2 LLM call — for those, tool data is **not** sent to z.ai a second time (the Pass-1 prompt was already sent).

**Not sent:** passwords, payment card data, auth tokens, data from other organizations, or education records (grades, transcripts, attendance).

### 3.3 Other z.ai Pipelines (outside chat)

Three server-side features also call z.ai with org PII:

| Pipeline | File | Data sent to z.ai |
|---|---|---|
| **Mentor bio generation** | `lib/mentorship/bio-generator.ts` (cron `mentor-bio-process`, explicit regenerate endpoint) | Mentor name, job title, company, industry, graduation year, sanitized LinkedIn headline/summary, custom attributes, chosen expertise/topics/sports/positions |
| **Match "why" generation** | `lib/mentorship/why-generator.ts` | Mentor/mentee names plus match-signal labels/values |
| **Mentee signal backfill** | `lib/mentorship/signal-backfill.ts` | Mentee goals free text (truncated to 400 chars, control characters stripped); a deterministic extractor short-circuits the LLM when it suffices |

All three are spend-capped per org (`checkAiSpend`) and audit-logged via `logAiRequest`.

### 3.4 What is Stored

| Table | Data Stored | Retention |
|---|---|---|
| `ai_threads` | Thread metadata (user_id, org_id, surface, title) | Until user deletes or account deletion cascade |
| `ai_messages` | Full prompt and response text | Until thread deletion or account deletion cascade |
| `ai_audit_log` | Request metadata: user_id, org_id, latency_ms, token counts, cache status, model, grounding outcome | Service-role only; no retention purge currently |
| `ai_semantic_cache` | Hashed prompt + cached response text | 12-hour TTL, purged by hourly cron |
| `ai_document_chunks` | Chunked org content with vector embeddings | Until re-indexed or org deletion |
| `mentor_profiles.bio` | AI-generated or manual mentor bio (`bio_source` records provenance) | Until edited/cleared by the mentor or admin |

---

## 4. Access Controls

- **Admin-only today:** production access requires the `admin` org role. A member-access allowlist (`ACTIVE_MEMBER_ALLOWED_TOOLS` in `access-policy.ts`) exists but is disabled behind `AI_MEMBER_ACCESS_KILL` (default on; flip with `AI_MEMBER_ACCESS_KILL=0`).
- **Per-role tool clients:** admins' tools run on the service-role client. Non-admin actors are restricted to an allowlisted read-tool set executed with their **RLS-bound client** (`NON_ADMIN_RLS_READ_TOOL_NAMES` in `tools/executor.ts`); if the RLS client is unavailable the call fails closed with an auth error. Tool modules additionally receive the resolved `actorRole` and must redact PII for non-admins — `list_member_preferences` returns `email: null` and never uses an email as a display-name fallback for non-admin actors.
- **Org-scoped RLS:** all AI tables enforce organization scoping via RLS policies.
- **Thread ownership:** users can only read/write their own threads (RLS on `ai_threads`, composite FK on `ai_messages`).
- **Audit logging:** every AI request is logged to `ai_audit_log` (service-role only table).

---

## 5. Grounding & Hallucination Controls

- **Pass-2 grounding check:** model-composed prose referencing tool data is verified against the tool's structured output (names, counts, amounts, mentorship reason codes). Ungrounded responses are replaced with a safe fallback. Mentorship reason codes are extracted via the single label⇄code table in `lib/mentorship/presentation.ts` (`REASON_CODE_LABEL_PATTERNS`); both `suggest_mentors` and `suggest_mentees` verify suggested names against tool rows.
- **Deterministic responses skip the check:** template-rendered single-tool answers are produced directly from tool data, so the regex self-check is not re-run on them.
- **Bio grounding:** generated mentor bios pass a deterministic fact-coverage check (`verifyBioGrounding`) before persisting; bios asserting numbers or proper nouns absent from the input fall back to a non-AI template (`template_grounding_rejected`).

---

## 6. Admin Exclusion Controls

Admins can exclude specific content from the AI indexing pipeline:

- **Table:** `ai_indexing_exclusions`
- **Mechanism:** Admins mark content types or specific records as excluded
- **Effect:** Excluded content is not chunked, embedded, or included in RAG retrieval
- **Audit:** The `excluded_by` column tracks which admin created each exclusion (SET NULL on user deletion to preserve the record)

---

## 7. Data Export

AI conversation data is included in the FERPA-compliant data export (`GET /api/user/export-data`):

- `aiConversations`: All threads owned by the user, with all messages per thread
- Fields exported: thread ID, message ID, role, content, created_at

---

## 8. Data Deletion

When a user account is deleted:

1. `auth.users` row is deleted via `auth.admin.deleteUser()`
2. `ai_threads` rows cascade-delete (FK to `auth.users` with ON DELETE CASCADE)
3. `ai_messages` rows cascade-delete (FK to `ai_threads`)
4. `ai_audit_log` entries persist with `user_id` set to NULL (audit trail survives deletion)
5. `ai_indexing_exclusions.excluded_by` set to NULL (exclusion record survives)

---

## 9. External API Provider

| Property | Value |
|---|---|
| Provider | z.ai |
| Model | glm-5.1 family (per-profile overrides in `lib/ai/llm.ts`) |
| API format | OpenAI-compatible |
| Data retention by provider | Per z.ai terms of service |
| Encryption in transit | TLS 1.2+ |

**Note:** No education records (grades, transcripts, attendance) are sent to the external API. However, per §3.2–3.3, member/donor emails, LinkedIn-derived profile data, and mentee goals text **are** sent when the relevant tools or pipelines run. Review the provider DPA against this surface before expanding access beyond admins.
