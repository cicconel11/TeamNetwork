# COPPA Compliance Guide (Children’s Online Privacy Protection Act)

**Applicability:** This document applies to any service collecting personal information from users **under age 13**. This applies even if TeamNetwork is a general sports app, if children under 13 are permitted to register.

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

* [ ] **Parent Portal:** Create a dashboard or request system allowing parents to:
    * [ ] Review their child’s information.
    * [ ] Revoke consent (stopping further collection).
    * [ ] Request deletion of existing data.

### STEP 5 — Data Minimization
**Principle:** Collect only what is reasonably necessary for the service.

* [ ] **Review Schema:** Remove optional fields for users <13.
* [ ] **Tracking:** Disable non-essential tracking/analytics identifiers for these users.

### STEP 6 — Security Measures
* [x] **Encryption:** AES-256 encryption at rest (Supabase PostgreSQL), TLS 1.2+ enforced on all connections.
* [x] **Access:** RBAC + RLS policies restrict data access. No children's data is collected (blocked at age gate).
* [x] **Breach Plan:** Incident response runbook created (`docs/Incident_Response_Runbook.md`), breach_incidents table tracks incidents.

### STEP 7 — Training
* [ ] **Staff Training:** Train team on "What is Personal Information" under COPPA.
* [ ] **Protocol:** Establish clear rules on how to handle parent requests.

### STEP 8 — Audit & Documentation
* [ ] **Logs:** Maintain secure logs of:
    * Consent records.
    * Notices sent to parents.
    * Requests processed (deletion/review).
* [ ] **Review:** Integrate COPPA reviews into every release cycle.

---

## SECTION 2 — Regional Considerations (New York)

**New York Privacy Protections:**
* Be aware that New York has broad privacy expectations that may extend beyond federal laws.
* Review compliance for future state laws (e.g., NY Privacy Acts) regarding data of minors.

---

## Quick Reference Checklist
- [x] Age Gate Implemented — See `docs/compliance_plans/COPPA_Age_Gate_Plan.md`
- [x] Parental Notice Workflow — Not needed; under-13 blocked before data collection
- [x] Verifiable Consent Mechanism — Not needed; no PII collected from under-13 users
- [x] Limited Data Collection Enforced — Under-13 blocked at age gate
- [x] Privacy Policy Updated for <13 — "children under 13" language in `/privacy`
- [x] Security Safeguards Verified — AES-256, TLS, RBAC, RLS
- [ ] Parental Access/Delete Tools Ready — Not needed unless under-13 data collection is enabled
- [ ] Staff Training Completed