# FERPA Compliance Guide (Family Educational Rights and Privacy Act)

**Applicability:** This document applies to any TeamNetwork service that collects, accesses, or stores education records from schools receiving federal funding (K–12 and most Higher Ed).

---

## SECTION 1 — Compliance Strategy

### STEP 1 — Determine Applicability and Data Scope
**Objective:** Identify if TeamNetwork collects PII linked to educational records.

* [x] **Audit Data Fields:** Does the app collect any of the following?
    * [x] Student names — Found in `alumni`, `members` tables (first_name, last_name)
    * [ ] School records/transcripts — NOT COLLECTED
    * [ ] Grades, attendance, or academic identifiers — Only `graduation_year` found (cohort marker, not grades)
    * [ ] Behavioral analytics tied to academic performance — NOT COLLECTED
* [x] **Trigger Check:** FERPA APPLIES — Names, emails, and photos are tied to organization contexts (schools/teams)

> **COMPLETED:** See `docs/Data_Inventory.md` for the full data inventory including:
> * Data Type
> * Source
> * Is it a Student Identifier?
> * Is it Stored/Processed?
> * Is it Sensitive?

### STEP 2 — Define Role Under FERPA
**Status:** TeamNetwork is a **Third-Party Service Provider** (School Official).

* [x] **Designation Memo:** Prepared below.

---

#### FERPA Designation Memo

**Date:** January 2026
**Subject:** TeamNetwork's Role Under FERPA

**1. Service Provider Status**

TeamNetwork operates as a Third-Party Service Provider under FERPA regulations. The platform provides membership management, communication, and engagement tools to educational institutions and their affiliated organizations (athletic teams, alumni networks, student groups).

**2. Data Access Scope**

Data access is limited strictly to purposes necessary for providing the contracted services:
- Member directory and profile management
- Organization-scoped communications (announcements, chat)
- Event coordination and scheduling
- Alumni engagement and networking

TeamNetwork does NOT access, store, or process traditional education records such as grades, transcripts, attendance records, or disciplinary information.

**3. Data Use and Disclosure Restrictions**

TeamNetwork commits to the following:
- **No Re-disclosure:** Student PII is never shared with third parties except as required to provide the service (e.g., email delivery via Resend, payment processing via Stripe).
- **No Secondary Use:** Data is never repurposed for advertising, profiling, or purposes beyond the contracted services.
- **No Sale of Data:** Student information is never sold or monetized.
- **Subprocessor Agreements:** All third-party services (Supabase, Stripe, Resend, Vercel) maintain their own compliance certifications and data processing agreements.

**4. Security Measures**

See `docs/Data_Inventory.md` for documented security controls including:
- Encryption at rest and in transit
- Row-Level Security (RLS) on all database tables
- Role-Based Access Control (RBAC)
- Input validation and rate limiting
- Data export and deletion capabilities

---

### STEP 3 — Data Sharing Agreements (Contracts)
**Requirement:** Written agreements are mandatory when receiving educational data.

* [x] **Draft Model Agreements:** Templates created in `docs/legal_templates/`:
    * `K12_Data_Sharing_Agreement.md` — School district contract with FERPA School Official designation
    * `Parent_Notification_Policy.md` — Plain-language parent transparency document
* [x] **Required Clauses:** All included in K12 agreement:
    * [x] Purpose of data access defined (Section 1, Section 2.2)
    * [x] Restrictions on permitted use (Section 3, Section 4)
    * [x] Strict prohibition on re-disclosure (Section 4.3)
    * [x] Security requirements defined (Section 6)
    * [x] "Return or Destroy" clause (Section 7 — 60-day deletion)
    * [x] Right to audit compliance (Section 8)

### STEP 4 — Data Protection & Access Controls
**Requirement:** Implement strict technical safeguards.

* [x] **Access Control:** RBAC implemented via `src/lib/auth/roles.ts` with three tiers: admin, active_member, alumni. Row-Level Security (RLS) policies on all Supabase tables. Middleware enforcement in `src/middleware.ts`.
* [x] **Encryption:** Supabase PostgreSQL uses AES-256 encryption at rest. TLS/SSL enforced for all connections (Supabase, Vercel deployment).
* [x] **Authentication:** Password policy upgraded to NIST standards (12+ chars with complexity requirements: uppercase, lowercase, number, special character). Security headers implemented in `next.config.mjs` including CSP, HSTS, X-Frame-Options. MFA/2FA not yet implemented.
* [ ] **Testing:** NOT VERIFIED — No evidence of scheduled vulnerability scanning. Recommend implementing automated security scans.

> **COMPLETED:** Security controls documented in `docs/Data_Inventory.md`. Additional measures found:
> * Rate limiting (`src/lib/security/rate-limit.ts`)
> * Input validation with Zod (`src/lib/schemas/`)
> * SSRF protection (`src/lib/schedule-security/safe-fetch.ts`)
> * Open redirect protection (`src/lib/auth/redirect.ts`)
> * hCaptcha integration (`src/lib/security/captcha.ts`)
> * Data export capability (`src/app/api/user/export-data/route.ts`)
> * Account deletion capability (`src/app/api/user/delete-account/route.ts`)

### STEP 5 — Use & Disclosure Policies
**Rule:** No unauthorized disclosure.

* [ ] **Policy Check:**
    * [ ] Data used ONLY for agreed purposes.
    * [ ] NO repurposing for unrelated analytics.
    * [ ] NO public disclosure of identifiable student data.
* [ ] **Distribution:** Distribute rules to staff, subcontractors, and developers.

### STEP 6 — Training
* [ ] **Mandatory Training:** All staff must complete FERPA training.
* [ ] **Refreshers:** Schedule annual compliance refreshers.
* [ ] **Sign-off:** Collect signed acknowledgments of understanding.

### STEP 7 — Data Rights Requests
**Right:** Students/Parents have the right to access or correct records.

* [ ] **Workflow:** Build internal processes to:
    * Receive data requests.
    * Route requests to the school data owner (the school usually fulfills the request).
    * Log the response time and action taken.

### STEP 8 — Audit & Maintenance
* [ ] **Internal Audit:** Perform quarterly internal reviews.
* [ ] **External Audit:** Schedule annual third-party security audits.
* [ ] **Update:** Review policies against new federal guidance annually.

---

## SECTION 2 — Regional Specifics (New York)

**New York Education Law (Section 2-d)** applies to schools in NY State.

* [ ] **Governance Review:** Before contracting with any NY district, review their specific data governance policies.
* [ ] **NYSED Alignment:** Ensure Data Sharing Agreements align with New York State Education Department (NYSED) rules regarding third-party contractors.
* [ ] **Parents' Bill of Rights:** Ensure the system supports the transparency requirements mandated for parents in NY.

---

## Quick Reference Checklist
- [x] Data Inventory Complete — See `docs/Data_Inventory.md`
- [x] Data Sharing Agreements Drafted — See `docs/legal_templates/`
- [x] Security & Access Controls Live — RBAC, RLS, encryption active
- [ ] Use & Disclosure Policy Published
- [ ] Staff Training Completed
- [ ] Rights Request Workflow Tested
- [ ] Audit Plan Scheduled