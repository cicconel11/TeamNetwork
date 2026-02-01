# K-12 Data Sharing Agreement

**Between TeamNetwork, Inc. ("Service Provider") and [SCHOOL DISTRICT NAME] ("District")**

**Effective Date:** [DATE]

---

## 1. Purpose and Scope

This Agreement establishes the terms under which the District shares student personally identifiable information (PII) with TeamNetwork for the purpose of providing membership management, communication, and engagement services for school-affiliated organizations (athletic teams, student groups, alumni networks).

---

## 2. School Official Designation

### 2.1 FERPA Authorization

Pursuant to 34 CFR § 99.31(a)(1)(i)(B), the District designates TeamNetwork as a "School Official" with legitimate educational interest in accessing student education records solely for the purposes described in this Agreement.

### 2.2 Legitimate Educational Interest

TeamNetwork's access to student data is limited to performing the following institutional services:

- Member directory and profile management for school organizations
- Organization-scoped communications (announcements, messaging)
- Event coordination and scheduling
- Alumni engagement and networking

### 2.3 Direct Control

The District maintains direct control over the use and maintenance of education records through:

- Administrative oversight of organization settings
- Approval of membership requests
- Configuration of data visibility and access permissions

---

## 3. Permitted Data Elements

TeamNetwork is authorized to receive and process only the following student data elements:

| Data Element | Purpose | Required/Optional |
|--------------|---------|-------------------|
| First Name | Member identification | Required |
| Last Name | Member identification | Required |
| Email Address | Account authentication, notifications | Required |
| Graduation Year | Cohort grouping, alumni classification | Required |
| Profile Photo | Member directory display | Optional |
| Organization Membership | Access control, role assignment | Required |

### 3.1 Data NOT Collected

TeamNetwork explicitly does NOT collect, store, or process:

- Social Security Numbers
- Student ID Numbers
- Date of Birth
- Home Address
- Grades, GPA, or Academic Performance Data
- Transcripts or Official Academic Records
- Attendance Records
- Disciplinary Records
- Health or Medical Records
- Financial Aid Information

---

## 4. Prohibited Uses

TeamNetwork shall NOT:

### 4.1 Commercial Exploitation
- Sell, rent, lease, or trade student PII to any third party
- Use student data for targeted advertising or marketing
- Create student profiles for commercial purposes

### 4.2 Data Mining
- Mine or analyze student data for purposes unrelated to the contracted services
- Use student data for behavioral profiling or predictive analytics
- Aggregate student data for sale to third parties

### 4.3 Unauthorized Disclosure
- Disclose student PII to any third party except as specified in Section 5 (Subprocessors)
- Share student data with affiliates or subsidiaries for their independent use
- Permit access to student data by unauthorized personnel

---

## 5. Authorized Subprocessors

TeamNetwork utilizes the following subprocessors to deliver its services. Each subprocessor maintains appropriate data protection certifications:

| Subprocessor | Function | Data Accessed |
|--------------|----------|---------------|
| Supabase | Database hosting | All permitted data elements |
| Vercel | Application hosting | All permitted data elements |
| Stripe | Payment processing | Email (for receipts only) |
| Resend | Email delivery | Email, First Name, Last Name |

### 5.1 Subprocessor Agreements

TeamNetwork maintains data processing agreements with all subprocessors that include:

- Restrictions on data use consistent with this Agreement
- Security requirements no less protective than those described herein
- Prohibition on further subcontracting without notice

### 5.2 Subprocessor Changes

TeamNetwork shall notify the District of any material changes to subprocessors at least 30 days prior to implementation.

---

## 6. Security Requirements

TeamNetwork implements the following security controls to protect student data:

### 6.1 Encryption

| Type | Standard | Implementation |
|------|----------|----------------|
| At Rest | AES-256 | Supabase PostgreSQL encryption |
| In Transit | TLS 1.2+ | SSL/TLS enforced on all connections |

### 6.2 Access Control

- **Role-Based Access Control (RBAC):** Three-tier system (admin, active_member, alumni) restricts data access based on user role
- **Row-Level Security (RLS):** Database-level policies ensure users access only authorized data
- **Middleware Validation:** Every request validates organization membership and permissions

### 6.3 Authentication

- **Password Policy:** Minimum 12 characters with complexity requirements (uppercase, lowercase, number, special character) per NIST SP 800-63B guidelines
- **Session Management:** Secure session handling with automatic timeout

### 6.4 Security Headers

- Content-Security-Policy (CSP)
- HTTP Strict Transport Security (HSTS)
- X-Frame-Options
- X-Content-Type-Options

### 6.5 Additional Protections

- Rate limiting on all API endpoints
- Input validation using schema enforcement
- SSRF protection for external data imports
- Open redirect protection

---

## 7. Data Retention and Destruction

### 7.1 Active Period

Student data shall be retained only for the duration of the organization's active use of TeamNetwork services.

### 7.2 Post-Termination Destruction

Upon termination of this Agreement or upon written request by the District:

1. TeamNetwork shall delete all student data within **60 calendar days**
2. Deletion shall include all backups and replicas
3. TeamNetwork shall provide **written confirmation** of data destruction upon completion

### 7.3 Exceptions

Data may be retained beyond the destruction period only if:

- Required by applicable law (with notification to District)
- Anonymized such that individual students cannot be identified

---

## 8. Audit Rights

### 8.1 Documentation Requests

The District may request documentation regarding TeamNetwork's security practices, including:

- Security policies and procedures
- Access control configurations
- Incident response plans
- Subprocessor agreements

TeamNetwork shall respond to documentation requests within 30 business days.

### 8.2 Annual Attestation

TeamNetwork shall provide an annual compliance attestation confirming:

- Continued adherence to the terms of this Agreement
- No security incidents involving District data (or detailed disclosure if any occurred)
- Current status of security controls

### 8.3 On-Site Audit

Upon 60 days written notice, the District may conduct or commission a security audit of TeamNetwork's systems and practices relevant to District data. Such audits shall:

- Occur during normal business hours
- Be limited to systems processing District data
- Be conducted no more than once per calendar year

---

## 9. Breach Notification

### 9.1 Discovery

In the event of a security breach involving student data, TeamNetwork shall:

1. Notify the District within **72 hours** of discovery
2. Provide a detailed incident report within **10 business days**
3. Cooperate with the District's investigation and notification obligations

### 9.2 Incident Report Contents

The incident report shall include:

- Nature and scope of the breach
- Data elements affected
- Number of students impacted
- Remediation steps taken
- Measures to prevent recurrence

---

## 10. Indemnification

TeamNetwork shall indemnify and hold harmless the District from any claims, damages, or liabilities arising from:

- TeamNetwork's breach of this Agreement
- TeamNetwork's violation of FERPA or applicable state privacy laws
- Negligent or wrongful acts by TeamNetwork or its subprocessors

---

## 11. Term and Termination

### 11.1 Term

This Agreement shall remain in effect for [TERM LENGTH] from the Effective Date and shall automatically renew for successive one-year periods unless terminated.

### 11.2 Termination for Convenience

Either party may terminate this Agreement with 90 days written notice.

### 11.3 Termination for Cause

Either party may terminate immediately upon material breach that remains uncured for 30 days after written notice.

### 11.4 Survival

Sections 4 (Prohibited Uses), 7 (Data Retention and Destruction), 8 (Audit Rights), 9 (Breach Notification), and 10 (Indemnification) shall survive termination.

---

## 12. Governing Law

This Agreement shall be governed by the laws of [STATE] and applicable federal law, including FERPA (20 U.S.C. § 1232g).

---

## 13. Amendments

This Agreement may be amended only by written agreement signed by authorized representatives of both parties.

---

## Signatures

**TeamNetwork, Inc.**

Signature: _________________________

Name: _________________________

Title: _________________________

Date: _________________________

---

**[SCHOOL DISTRICT NAME]**

Signature: _________________________

Name: _________________________

Title: _________________________

Date: _________________________

---

*Document Version: 1.0*
*Last Updated: January 2026*
