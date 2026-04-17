# COPPA Compliance Guide (Children’s Online Privacy Protection Act)

**Applicability:** This document applies to any service collecting personal information from users **under age 13**. This applies even if TeamNetwork is a general sports app, if children under 13 are permitted to register.

**Last regulatory review:** April 16, 2026.
**Current posture:** Under-13 users are blocked at the age gate (`/auth/parental-consent`). No PII is collected from under-13s, so 16 CFR 312.5 verifiable parental consent is not triggered. Age bracket (`under_13`, `13_17`, `18_plus`) is derived transiently; DOB is never stored.
**Regulatory context:** The FTC's amended COPPA Rule (finalized Jan 2025, effective Jun 23 2025, compliance deadline Apr 22 2026) adds requirements even for operators who do not collect from children — notably a documented data retention policy and a written information security program. See `Data_Inventory.md` and `legal_templates/Use_Disclosure_Policy.md`.

---

## SECTION 1 — Compliance Strategy

### STEP 1 — Determine Data Collection
**Trigger:** COPPA applies if we collect:
* Name, email, login credentials
* Photos, videos, audio
* Persistent identifiers (cookies, IP addresses, device IDs)
* Geolocation data
* Behavioral analytics linked to an ID

* [x] **ACTION:** Audit completed. Registration flow audited — Neutral Age Gate implemented to identify <13 users.

> **Note:** Neutral Age Gate implemented per `docs/compliance_plans/COPPA_Age_Gate_Plan.md`. The age gate collects DOB transiently to calculate `age_bracket` ("under_13", "13_17", "18_plus") without permanently storing Date of Birth, maintaining FERPA Data Minimization principles.

### STEP 2 — Privacy Policy Requirements
**Requirement:** The privacy policy must be clear and accessible.

* [ ] **Draft Policy Section:** Create a specific "Children's Privacy" section covering:
    * [ ] What data is collected.
    * [ ] How the data is used.
    * [ ] Who the data is shared with.
    * [ ] Data retention periods.
    * [ ] Explanation of parents' rights.

### STEP 3 — Parental Notice & Consent
**Rule:** You cannot collect data from a child <13 without verifiable parental consent.

* [x] **Status:** Under-13 users are blocked at the age gate before any data collection occurs. No personal information is collected from children under 13, so verifiable parental consent is not required. The age gate redirects under-13 users to `/auth/parental-consent` before any account is created or any PII is stored.

> **Rationale:** Full verifiable parental consent (credit card auth, government ID, etc.) is not required because the age gate prevents all data collection from under-13 users. COPPA's consent requirements apply only when PII is actually collected from children under 13.

### STEP 4 — Parental Controls
**Rights:** Parents must have full control over their child's data.

* [x] **N/A — not triggered.** No under-13 data is collected, so COPPA parental-portal obligations do not apply. If that posture ever changes (e.g. a school-specific pilot explicitly enables under-13 accounts), reopen this section.

### STEP 5 — Data Minimization
**Principle:** Collect only what is reasonably necessary for the service.

* [x] **Review Schema:** Verified no code path reaches profile-completion flows when `age_bracket = 'under_13'`; the age gate short-circuits to `/auth/parental-consent` before any insert. Schema carries no DOB column (see `Data_Inventory.md` "Data Not Collected").
* [x] **Tracking:** `analytics_events` + `usage_events` are gated by `analytics_consent` and by the age gate upstream. Allowlisted event names only (see `src/lib/analytics/policy.ts`).

### STEP 6 — Security Measures
* [x] **Encryption:** AES-256 encryption at rest (Supabase PostgreSQL), TLS 1.2+ enforced on all connections.
* [x] **Access:** RBAC + RLS policies restrict data access. No children's data is collected (blocked at age gate).
* [x] **Breach Plan:** Incident response runbook created (`docs/Incident_Response_Runbook.md`), breach_incidents table tracks incidents.

### STEP 7 — Training
**Protocol (current — sized for small engineering teams):**

1. Annual 30-minute written policy review — this doc + `Data_Inventory.md` + `legal_templates/Use_Disclosure_Policy.md`.
2. Signed acknowledgment using `legal_templates/Staff_Data_Handling_Acknowledgment.md`.
3. Track one attestation per engineer per year.
4. New hires: acknowledgment added to onboarding checklist.

This is intentionally not an LMS — COPPA does not require one for teams of this size.

* [ ] Current annual attestation on file (date: ____)
* [x] Acknowledgment template exists (`legal_templates/Staff_Data_Handling_Acknowledgment.md`)
* [x] Parent-request handling path documented in STEP 4 rationale and in `Incident_Response_Runbook.md`.

### STEP 8 — Audit & Documentation
* [x] **Logs exist:**
    * `compliance_audit_log` — age-gate events (hashed IP, age bracket; no DOB/PII)
    * `user_deletion_requests` — GDPR / COPPA deletion queue with 30-day grace period
    * `breach_incidents` — incident log (see `Incident_Response_Runbook.md`)
* [ ] **Cadence:** monthly automated audit-log review (script), quarterly manual review. Owner: ____

---

## SECTION 2 — Regional Considerations (New York)

**New York Privacy Protections:**
* Be aware that New York has broad privacy expectations that may extend beyond federal laws.
* Review compliance for future state laws (e.g., NY Privacy Acts) regarding data of minors.

---

## Data Subject Rights Requests (DSR)

COPPA and FERPA both require a rights-request path, even when most substantive requests route through the school as the records holder.

- **Intake:** `privacy@myteamnetwork.com` + support form.
- **Verification:** match requester email to `auth.users`; confirm role/relationship.
- **Deletion path:** enqueue a `user_deletion_requests` row (30-day grace, existing pipeline).
- **SLA target:** acknowledge ≤10 days, resolve ≤30 days.
- **Audit:** log in `data_access_log` / `compliance_audit_log`.

## Quick Reference Checklist
- [x] Age Gate Implemented — See `docs/compliance_plans/COPPA_Age_Gate_Plan.md`
- [x] Parental Notice Workflow — Not needed; under-13 blocked before data collection
- [x] Verifiable Consent Mechanism — Not needed; no PII collected from under-13 users
- [x] Limited Data Collection Enforced — Under-13 blocked at age gate
- [x] Privacy Policy Updated for <13 — "children under 13" language in `/privacy`
- [x] Security Safeguards Verified — AES-256, TLS, RBAC, RLS
- [x] Parental Access/Delete Tools — Not triggered; COPPA VPC inapplicable while no under-13 PII is collected
- [ ] Annual staff attestation on file — date: ____
- [x] Audit log tables exist — `compliance_audit_log`, `user_deletion_requests`, `breach_incidents`
- [x] DSR intake + workflow documented