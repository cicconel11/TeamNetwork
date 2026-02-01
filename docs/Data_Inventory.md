# Data Inventory for FERPA Compliance

This document catalogs all personally identifiable information (PII) and education-related data collected by TeamNetwork to support FERPA compliance assessments.

**Last Updated:** January 2026
**Source:** Codebase analysis of `src/types/database.ts` (Supabase schema)

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
| `form_submissions.data` | `form_submissions` | Variable - may contain any user input |
| `workout_logs` | `workout_logs` | Athletic performance metrics |
| `competition_points` | `competition_points` | Performance/ranking data |
| `contact_name`, `contact_email`, `contact_phone` | `leads` | Parent/guardian PII |
| `current_city` | `alumni` | Location data |

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

## Data Flow Summary

```
User Registration
       ↓
Organization Membership Request
       ↓
Admin Approval (role assignment)
       ↓
User gains access to org-scoped data
       ↓
All access governed by:
  - Supabase Row-Level Security (RLS)
  - Middleware membership validation
  - Role-based access control (admin/active_member/alumni)
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

1. **Password Policy Enhancement**: Current minimum is 6 characters (`src/lib/auth/password.ts`). Recommend increasing to 12+ with complexity requirements.

2. **Multi-Factor Authentication**: Not currently implemented. Recommend adding TOTP/backup codes for admin accounts.

3. **Security Headers**: Add Content-Security-Policy, HSTS, X-Frame-Options headers in `next.config.mjs`.

4. **Account Lockout**: Implement brute-force protection after failed login attempts.

5. **Vulnerability Scanning**: Schedule regular automated security scans.
