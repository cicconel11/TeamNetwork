# Data Inventory for FERPA Compliance

This document catalogs the main classes of PII and education-adjacent data currently stored by TeamNetwork.

**Last Updated:** April 16, 2026
**Primary Sources:** `src/types/database.ts`, `src/lib/analytics/policy.ts`, and current Supabase migrations (266 as of this revision).

---

## Overview

TeamNetwork is a multi-tenant SaaS platform for schools, teams, booster groups, and alumni organizations. The platform stores identity and activity data tied to organization membership, so FERPA analysis should assume educational-context data is in scope whenever a school or school-affiliated organization uses the product.

---

## Core Identity Data

| Data Type | Source Table(s) | Classification | Notes |
|-----------|-----------------|----------------|-------|
| `first_name`, `last_name` | `members`, `alumni`, `parents`, `users` | Direct identifier | Primary user-facing identity fields |
| `email` | `users`, `members`, `alumni`, `parents`, `parent_invites`, `enterprise_invites` | Direct identifier | Contact, invite, and account lookup data |
| `phone_number` | `alumni`, `parents`, `notification_preferences` | Direct identifier | Optional contact data |
| `photo_url`, `avatar_url` | `members`, `alumni`, `parents`, `users`, `media_items` | Direct/visual identifier | Profile and media-related imagery |
| `linkedin_url` | `members`, `alumni`, `parents` | Indirect identifier | External profile linkage |
| `user_id`, `organization_id`, `enterprise_id` | Membership and role tables | Indirect identifier | Links a person to an organization or enterprise context |

---

## Education- and Organization-Context Data

| Data Type | Source Table(s) | Sensitive? | Notes |
|-----------|-----------------|------------|-------|
| `graduation_year` | `members`, `alumni` | Medium | Cohort/roster history |
| `academic_schedules` | `academic_schedules` | High | Class/activity timing and notes |
| Organization membership and role assignment | `user_organization_roles` | High | Ties a person to a school/team context |
| Parent-to-student relationship metadata | `parents` | High | Includes `student_name` and `relationship` |
| Forms and document submissions | `form_submissions`, `form_document_submissions` | High | Freeform user-provided content |
| Chat, discussions, feed, and comments | `chat_messages`, `discussion_threads`, `discussion_replies`, `feed_posts`, `feed_comments` | High | Private or semi-private communications |
| Workout, event RSVP, and competition records | `workout_logs`, `event_rsvps`, `competition_points` | Medium | Participation and performance data |

---

## Parent and Guardian Data

Parent and guardian records are now first-class data in the app and must be included in compliance reviews.

| Data Type | Source Table(s) | Classification | Notes |
|-----------|-----------------|----------------|-------|
| Parent profile data | `parents` | Direct identifier | Names, email, phone, photo, notes |
| Parent invite data | `parent_invites` | Direct identifier | Email or code-based onboarding metadata |
| Student linkage | `parents.student_name`, `parents.relationship` | Education-adjacent | Connects guardian identity to a student/member context |
| Parent role membership | `user_organization_roles.role = 'parent'` | Access-control data | Parent access is enforced throughout org-scoped routes and navigation |

---

## Analytics and Operational Telemetry

TeamNetwork now stores limited behavioral and operational analytics. This is governed by allowlisted event names and policy checks in `src/lib/analytics/policy.ts`; it is not accurate to describe the system as collecting "no behavioral data."

| Data Type | Source Table(s) | Sensitivity Reason |
|-----------|-----------------|-------------------|
| Product analytics events | `analytics_events` | Behavioral usage data tied to org/session context |
| Analytics consent state | `analytics_consent` | Consent and privacy state |
| Operational analytics events | `analytics_ops_events`, `ops_events` | Internal operational telemetry with route/session metadata |
| Error and telemetry events | `error_groups`, `error_events` (via current schema/migrations), telemetry routes | Diagnostic data that may include route, environment, and user context |

Behavioral analytics remains constrained by product policy and schema enforcement, but it is still stored data and should be documented as such.

---

## Sensitive Data Classes

| Data Type | Source Table(s) | Sensitivity Reason |
|-----------|-----------------|-------------------|
| Private communications | `chat_messages`, `discussion_threads`, `discussion_replies`, `feed_comments` | Student/community communications |
| Form responses | `form_submissions.responses` | Freeform input may contain sensitive personal information |
| Parent notes | `parents.notes` | Freeform guardian/student context |
| Athletic/performance metrics | `workout_logs`, `competition_points` | Performance and participation data |
| Location-related fields | `alumni.current_city` | Location data |
| Media uploads and moderation state | `media_items`, `media_uploads` | Visual identity and moderation metadata |
| Enterprise audit logs | `enterprise_audit_logs` | Admin activity metadata including actor email, IP, and user agent |

---

## Data Not Collected

The current app still does **not** appear to store the following as first-class product data:

| Data Type | Status | Notes |
|-----------|--------|-------|
| Social Security Numbers | Not collected | No government ID storage |
| Student ID numbers | Not collected | No institutional SIS identifier field in current schema |
| Date of birth | Not collected | Current identity model relies on graduation year and age-gate logic, not DOB storage |
| Home street address | Not collected | City-level alumni field exists, but not a full postal address model |
| Grades / GPA / transcripts | Not collected | No academic performance record model |
| Financial aid records | Not collected | Billing data is for platform subscriptions/donations, not school aid |
| Medical records | Not collected | No HIPAA-style health record model |

Disciplinary data is also not modeled as a dedicated feature, but the app does now store limited behavioral analytics and communication data, so older wording that implied "no behavioral data" is no longer accurate.

---

## Enterprise Data

Enterprise accounts add another layer of admin and billing PII:

| Data Type | Source Table(s) | Classification | Notes |
|-----------|-----------------|----------------|-------|
| Billing contact email | `enterprises` | Direct identifier | Enterprise billing contact |
| Admin invite emails | `enterprise_invites` | Direct identifier | Enterprise onboarding |
| Enterprise role assignments | `user_enterprise_roles` | Indirect identifier | Links user identity to enterprise privileges |
| Enterprise audit logs | `enterprise_audit_logs` | Sensitive admin metadata | Includes actor email, IP, user agent, action metadata |
| Record access log | `data_access_log` | Sensitive audit metadata | Per-resource access telemetry for FERPA / NY Ed Law 2-d; raw IPs hashed (`20261012030000_hash_existing_raw_ips.sql`) |
| Incident log | `breach_incidents` | Sensitive incident metadata | Discovery / containment / resolution timestamps, notification log (backs `Incident_Response_Runbook.md`) |
| User agreement log | `user_agreements` | Consent/version metadata | ToS / Privacy / DSA version acceptance per user |

Current retention guidance is no longer "undefined." The repo includes audit-log retention work in `supabase/migrations/20260501110000_audit_log_retention.sql`, so future compliance docs should describe the implemented retention behavior instead of calling it unbounded.

---

## FERPA Applicability

**Conclusion: FERPA likely applies whenever TeamNetwork is used by covered educational institutions or their agents.**

Reasons:

1. The app stores names, emails, photos, and organization-linked role data.
2. The app stores schedules, communications, forms, and other records tied to school/team contexts.
3. Parent and guardian data is now part of the live schema and access model.

Even without grades or transcripts, the platform still handles education-adjacent records that require contractual, technical, and disclosure controls consistent with FERPA expectations.

---

## Security Controls Present in the App

| Control | Status | Implementation |
|---------|--------|----------------|
| Encryption at rest | Active | Supabase/PostgreSQL managed storage |
| Encryption in transit | Active | HTTPS/TLS |
| Row-Level Security | Active | Supabase RLS policies across product tables |
| Role-based access control | Active | Org and enterprise role helpers in `src/lib/auth/` |
| Input validation | Active | Zod schemas in `src/lib/schemas/` |
| Rate limiting | Active | `src/lib/security/rate-limit.ts` and related helpers |
| Data export | Active | `src/app/api/user/export-data/route.ts` |
| Account deletion | Active | `src/app/api/user/delete-account/route.ts` |

---

## Recommendations

1. Add MFA for high-privilege accounts, especially org admins and enterprise owners.
2. Document analytics retention and disclosure boundaries alongside the existing analytics policy code.
3. Keep parent/guardian data explicitly represented in FERPA and COPPA documentation rather than treating it as a side effect of member data.
4. Re-run this inventory whenever major schema additions land in `supabase/migrations/`.
