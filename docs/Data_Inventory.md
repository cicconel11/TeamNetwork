# Data Inventory for FERPA Compliance

This document catalogs all personally identifiable information (PII) and education-related data collected by TeamNetwork to support FERPA compliance assessments.

**Last Updated:** February 2026
**Source:** Codebase analysis of `src/types/database.ts` and `src/types/enterprise.ts` (Supabase schema)

---

## Overview

TeamNetwork is a multi-tenant SaaS platform serving organizations (schools, teams, alumni networks). The platform collects PII tied to educational contexts through organization membership, making FERPA applicable when serving K-12 or higher education institutions receiving federal funding.

---

## Student Identifiers

The following fields can directly or indirectly identify students:

| Data Type | Source Table(s) | Classification | Notes |
|-----------|-----------------|----------------|-------|
| `first_name`, `last_name` | `alumni`, `members` | Direct Identifier | Full legal names |
| `email` | `alumni`, `members`, `users` | Direct Identifier | Primary contact method |
| `phone_number` | `alumni` | Direct Identifier | Optional field |
| `photo_url`, `avatar_url` | `alumni`, `members`, `users` | Biometric Identifier | Profile images |
| `linkedin_url` | `alumni`, `members` | Indirect Identifier | Links to external PII |
| `holder_name` | `records` | Direct Identifier | Achievement attribution |

---

## Educational Records

Data tied to academic or organizational contexts:

| Data Type | Source Table | Sensitive? | Notes |
|-----------|--------------|------------|-------|
| `graduation_year` | `alumni`, `members` | No | Cohort marker, not academic performance |
| `major` (field of study) | `alumni` | No | Academic program information |
| `academic_schedules` (title, times, notes) | `academic_schedules` | Yes | Class/activity schedules |
| `organization_id` + membership | `organization_members` | Yes | Ties identity to institution |

---

## Sensitive Data

Data requiring heightened protection:

| Data Type | Source Table | Sensitivity Reason |
|-----------|--------------|-------------------|
| `chat_messages.body` | `chat_messages` | Private student communications |
| `form_submissions.responses` | `form_submissions` | Variable — may contain any user input |
| `workout_logs` | `workout_logs` | Athletic performance metrics |
| `competition_points` | `competition_points` | Performance/ranking data |
| `current_city` | `alumni` | Location data |
| `billing_contact_email` | `enterprises` | Enterprise billing contact PII |
| `enterprise_audit_logs` (actor_email, ip_address, user_agent) | `enterprise_audit_logs` | Admin activity audit trail |

---

## Data NOT Collected

TeamNetwork explicitly does **not** collect the following sensitive education records:

| Data Type | Status | Notes |
|-----------|--------|-------|
| Social Security Numbers (SSN) | ❌ Not Collected | No government IDs stored |
| Student ID Numbers | ❌ Not Collected | No institutional identifiers |
| Date of Birth | ❌ Not Collected | Only `graduation_year` for cohort |
| Home Address | ❌ Not Collected | Only `current_city` for alumni |
| Grades / GPA | ❌ Not Collected | No academic performance data |
| Transcripts | ❌ Not Collected | No official records |
| Attendance Records | ❌ Not Collected | No attendance tracking |
| Disciplinary Records | ❌ Not Collected | No behavioral data |
| Financial Aid Information | ❌ Not Collected | Payment data is for org subscriptions only |
| Health / Medical Records | ❌ Not Collected | No HIPAA-relevant data |

---

## Enterprise Data

Enterprise accounts manage multiple organizations under a single billing entity. The following tables store enterprise-scoped PII:

| Data Type | Source Table | Classification | Notes |
|-----------|-------------|----------------|-------|
| `billing_contact_email` | `enterprises` | Direct Identifier | Enterprise billing contact |
| `actor_email`, `ip_address`, `user_agent` | `enterprise_audit_logs` | Direct/Indirect Identifier | Admin action audit trail |
| `email` | `enterprise_invites` | Direct Identifier | Invited admin email |
| `user_id` + `role` | `user_enterprise_roles` | Indirect Identifier | Links user identity to enterprise admin role |

**Enterprise access control:**
- Enterprise RLS uses `is_enterprise_member()` and `is_enterprise_owner()` helper functions
- Roles: `owner` (full access), `billing_admin` (billing only), `org_admin` (org management)
- Audit logs capture actor email, IP, and user agent for all administrative actions

## Data Flow Summary

```
User Registration
       ↓
Organization Membership Request  ─OR─  Enterprise Admin Invite
       ↓                                       ↓
Admin Approval (role assignment)        Accept invite (enterprise role)
       ↓                                       ↓
User gains access to org-scoped data    User gains access to enterprise dashboard
       ↓                                       ↓
All access governed by:                 Enterprise access governed by:
  - Supabase Row-Level Security (RLS)    - Enterprise RLS policies
  - Middleware membership validation      - Enterprise role checks
  - Role-based access control             - Audit logging
```

---

## FERPA Applicability Determination

**Conclusion: FERPA APPLIES**

TeamNetwork collects:
- ✅ Student names (first_name, last_name)
- ✅ Student email addresses
- ✅ Photo identifiers (avatar_url, photo_url)
- ✅ Data tied to organization contexts (schools/teams)
- ✅ Graduation year (educational cohort indicator)

Although TeamNetwork does not store traditional "education records" (grades, transcripts, attendance), the collection of PII tied to educational institution contexts triggers FERPA requirements for:
1. Data protection safeguards
2. Third-party service provider agreements
3. Prohibition on unauthorized disclosure

---

## Security Controls Applied

| Control | Status | Implementation |
|---------|--------|----------------|
| Encryption at Rest | ✅ Active | Supabase PostgreSQL (AES-256) |
| Encryption in Transit | ✅ Active | TLS/SSL enforced |
| Row-Level Security | ✅ Active | All tables have RLS policies |
| Role-Based Access Control | ✅ Active | `src/lib/auth/roles.ts` |
| Input Validation | ✅ Active | Zod schemas in `src/lib/schemas/` |
| Rate Limiting | ✅ Active | `src/lib/security/rate-limit.ts` |
| Data Export (GDPR) | ✅ Active | `src/app/api/user/export-data/route.ts` |
| Account Deletion | ✅ Active | `src/app/api/user/delete-account/route.ts` |

---

## Recommendations

1. ~~**Password Policy Enhancement**~~: Resolved — password policy upgraded to NIST standards (12+ chars). See FERPA_COMPLIANCE.md.

2. **Multi-Factor Authentication**: Not currently implemented. Recommend adding TOTP/backup codes for admin and enterprise owner accounts.

3. ~~**Security Headers**~~: Resolved — CSP, HSTS, X-Frame-Options headers added in `next.config.mjs`.

4. **Account Lockout**: Implement brute-force protection after failed login attempts.

5. **Vulnerability Scanning**: Schedule regular automated security scans.

6. **Enterprise Data Retention**: Define retention policy for `enterprise_audit_logs` (currently unbounded). Consider 90-day or 1-year rolling purge.
