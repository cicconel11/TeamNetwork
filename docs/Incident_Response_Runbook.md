# Incident Response Runbook

**Version:** 1.1
**Last Updated:** April 16, 2026
**Related tables:** `breach_incidents`, `data_access_log`, `compliance_audit_log`
**Related docs:** `FERPA_COMPLIANCE.md` (STEP 7–8), `COPPA_COMPLIANCE.md` (DSR section), `legal_templates/K12_Data_Sharing_Agreement.md` (Section 9)

---

## 1. Detection Triggers

An incident investigation is triggered when any of the following occur:

- Supabase or Vercel alert for anomalous access patterns
- Dependabot/npm audit flags a critical vulnerability in a deployed dependency
- User reports unauthorized access or data exposure
- Audit log review reveals unexpected data access patterns
- Third-party notification (e.g., HaveIBeenPwned, security researcher)
- Failed authentication spike detected in error monitoring

---

## 2. Severity Classification

### Tier 1 — Critical
- Confirmed unauthorized access to education records
- Data exfiltration (any volume)
- Exposed credentials (API keys, database connection strings)
- Ransomware or destructive attack

### Tier 2 — High
- Vulnerability actively exploitable but no evidence of exploitation
- Unauthorized access to non-education PII (emails, names)
- Privilege escalation (user gained admin access)
- RLS policy bypass

### Tier 3 — Low
- Vulnerability discovered but not yet exploitable (requires additional conditions)
- Failed attack attempts (blocked by rate limiting, WAF)
- Misconfiguration with no data exposure

---

## 3. Notification Timelines

Per K-12 Data Sharing Agreement (Section 9) and NY Education Law 2-d:

| Notification | Deadline | Required By |
|---|---|---|
| Vendor → School District | **72 hours** from discovery | K-12 Agreement Section 9.1 |
| Vendor → NYS Education Department | **10 business days** from discovery | NY Education Law 2-d |
| Vendor → Affected Parents | **14 calendar days** from discovery | NY Education Law 2-d |

**Important:** Timelines begin at **discovery**, not at confirmation. When in doubt, start the clock.

---

## 4. Response Steps

### Step 1: Contain (0-4 hours)
1. Identify the attack vector and affected systems
2. Revoke compromised credentials immediately
3. If RLS bypass: add emergency deny-all policy on affected tables
4. If credential exposure: rotate all exposed keys in Vercel/Supabase dashboard
5. Document containment actions in `breach_incidents` table

### Step 2: Assess (4-24 hours)
1. Query affected tables to estimate record count:
   ```sql
   -- Example: check data_access_log for unusual patterns
   SELECT resource_type, COUNT(*) 
   FROM data_access_log 
   WHERE accessed_at > '[incident_start]' 
   GROUP BY resource_type;
   ```
2. Identify affected organizations and user counts
3. Classify severity tier (see Section 2)
4. Update `breach_incidents` row with assessment details

### Step 3: Notify (per timelines above)
1. **72 hours:** Email affected school district IT contacts
   - Include: nature of breach, data elements affected, containment status
   - Template: see Section 6
2. **10 business days:** File with NYSED
3. **14 calendar days:** Notify affected parents
   - Use Resend to send templated notification
   - Include: what happened, what data was involved, what we're doing about it
4. Update `breach_incidents` notification timestamps

### Step 4: Remediate
1. Deploy fix for the root cause
2. Verify fix with security review
3. Run `npm audit` to confirm no remaining critical vulnerabilities
4. Review and harden related code paths

### Step 5: Document
1. Update `breach_incidents.resolution_notes` with:
   - Root cause analysis
   - Timeline of events
   - Remediation actions taken
   - Preventive measures implemented
2. Set `resolved_at` timestamp
3. Conduct post-incident review within 7 days

---

## 5. Contact List Template

| Role | Name | Email | Phone |
|---|---|---|---|
| Incident Commander | [TBD] | | |
| Engineering Lead | [TBD] | | |
| Legal Counsel | [TBD] | | |
| District IT Contact | [Per agreement] | | |
| NYSED Contact | | privacy@nysed.gov | |
| Support Email | | support@myteamnetwork.com | |

---

## 6. District Notification Template

Subject: Security Incident Notification — TeamNetwork

Dear [District IT Contact],

We are writing to notify you of a security incident affecting TeamNetwork, in accordance with our Data Sharing Agreement (Section 9) and NY Education Law 2-d.

**Discovery Date:** [DATE]
**Nature of Incident:** [DESCRIPTION]
**Data Elements Potentially Affected:** [LIST]
**Estimated Records Affected:** [COUNT]
**Current Status:** [Contained / Under Investigation / Resolved]

**Actions Taken:**
- [CONTAINMENT ACTIONS]
- [REMEDIATION STEPS]

A full incident report will follow within 10 business days.

If you have questions, please contact [INCIDENT COMMANDER] at [EMAIL].

Sincerely,
TeamNetwork Security Team
