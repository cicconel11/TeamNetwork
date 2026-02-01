# Use & Disclosure Policy

**TeamNetwork, Inc. — Data Use and Disclosure Policy**

**Effective Date:** February 2026

---

## 1. Purpose Statement

This policy governs how TeamNetwork collects, uses, and discloses user data. Our commitment is to use data solely for the purposes of providing membership management, communication, and organization engagement features to our users.

TeamNetwork operates as a service provider to schools, athletic programs, alumni networks, and similar organizations. Data processed through our platform serves the following core purposes:

- **Member Management:** Maintaining accurate member directories and profiles
- **Communication:** Facilitating organization announcements, messaging, and notifications
- **Event Coordination:** Managing schedules, events, and calendar synchronization
- **Alumni Engagement:** Connecting current members with alumni networks
- **Organization Administration:** Enabling administrators to manage settings, roles, and permissions

---

## 2. Prohibited Uses

TeamNetwork strictly prohibits the following uses of user data:

### 2.1 Commercial Exploitation
- **No Sale of Data:** User data is never sold, rented, leased, or traded to any third party
- **No Advertising:** User data is never used for targeted advertising or marketing purposes
- **No Profiling:** User data is never used to create commercial profiles or behavioral models

### 2.2 Analytics Repurposing
- **No Secondary Analytics:** Data collected for one purpose is never repurposed for unrelated analytics
- **No Data Mining:** User data is never mined for insights beyond the contracted service purposes
- **No Aggregation for Sale:** User data is never aggregated and sold to third parties

### 2.3 Public Disclosure
- **No Public Exposure:** Identifiable user data is never disclosed publicly without explicit consent
- **No Directory Listings:** User information is never shared in public directories or listings
- **No Social Media Sharing:** User data is never automatically posted to social media or external platforms

---

## 3. Approved Third-Party Services

TeamNetwork integrates with the following third-party services to deliver its functionality. Each service has a specific, disclosed purpose and receives only the minimum data necessary.

### 3.1 Automatic Backend Services

These services process data automatically as part of normal platform operations:

| Service | Purpose | Data Shared | Legal Basis |
|---------|---------|-------------|-------------|
| **Supabase** | Database hosting, authentication | All user data | Service provision |
| **Stripe** | Payment processing | Names, emails, payment amounts | Service provision |
| **Resend** | Email delivery | Email addresses, names, notification content | Service provision |
| **Vercel** | Application hosting | All user data (in transit) | Service provision |
| **hCaptcha** | Bot protection | IP address, browser fingerprint | Security/fraud prevention |

### 3.2 User-Initiated Services (Explicit Consent)

These services require explicit user action to activate:

| Service | Purpose | Data Shared | Consent Mechanism |
|---------|---------|-------------|-------------------|
| **Google Calendar** | Calendar synchronization | Email address, calendar events | User clicks "Sync" button, authorizes via Google OAuth consent screen |

**Important Distinction:** User-initiated integrations like Google Calendar require affirmative user action:

1. User explicitly clicks a "Sync" button
2. User is redirected to Google's OAuth consent screen
3. User reviews requested permissions
4. User explicitly grants authorization
5. User can disconnect at any time via account settings

This user-initiated consent flow provides **specific, informed consent** — a stronger legal position than automatic backend processing. The user has full control over whether to enable the integration and can revoke access at will.

---

## 4. Data Access Rules

### 4.1 Role-Based Access

Data access is governed by role-based access control (RBAC):

| Role | Access Level | Restrictions |
|------|--------------|--------------|
| **Admin** | Full organization data | Cannot access other organizations |
| **Active Member** | Organization content, own profile | Cannot access admin settings or other members' private data |
| **Alumni** | Read-only organization content | Cannot modify data, limited feature access |

### 4.2 Organization Boundaries

- Users can only access data within organizations they belong to
- Cross-organization data access is prohibited
- Row-Level Security (RLS) policies enforce boundaries at the database level

### 4.3 Staff Access

TeamNetwork staff access to user data is restricted to:

- **Customer Support:** Resolving user-reported issues (with user consent)
- **Security Response:** Investigating security incidents
- **Legal Compliance:** Responding to valid legal requests

All staff access is logged and subject to audit.

### 4.4 No Third-Party Access

User data is never shared with third parties except:

- Approved subprocessors listed in Section 3
- Valid legal requests (subpoenas, court orders)
- With explicit user consent for user-initiated integrations

---

## 5. Security Controls

Data is protected by the following technical safeguards:

### 5.1 Encryption
- **At Rest:** AES-256 encryption for all stored data
- **In Transit:** TLS 1.2+ for all connections

### 5.2 Authentication
- Password requirements: 12+ characters with complexity (uppercase, lowercase, number, special character)
- Secure session management with automatic timeout

### 5.3 Access Control
- Row-Level Security (RLS) on all database tables
- Middleware validation on every request
- Role-based permissions enforced at application and database layers

### 5.4 Additional Protections
- Rate limiting on all API endpoints
- Input validation using Zod schemas
- SSRF protection for external data imports
- Open redirect protection
- hCaptcha bot protection

---

## 6. Enforcement

### 6.1 Staff Violations

Violations of this policy by TeamNetwork staff may result in:

- Immediate termination of employment
- Revocation of system access
- Legal action if warranted

### 6.2 Contractor Violations

Third-party contractors or subprocessors who violate this policy will face:

- Immediate contract termination
- Data processing agreement enforcement
- Legal remedies as applicable

### 6.3 Reporting Violations

Suspected policy violations should be reported to:

- **Internal:** security@myteamnetwork.com
- **External:** Users can report concerns via the in-app feedback system or by emailing privacy@myteamnetwork.com

---

## 7. User Rights

### 7.1 Data Export

Users can export their personal data at any time via:
- Account Settings → Export Data

### 7.2 Data Deletion

Users can request account deletion via:
- Account Settings → Delete Account

Deletion is processed within 30 days and includes all personal data, backups, and replicas.

### 7.3 Consent Withdrawal

Users can withdraw consent for user-initiated integrations (e.g., Google Calendar sync) at any time by disconnecting the integration in their account settings.

---

## 8. Review Schedule

This policy is reviewed and updated:

- **Annually:** Comprehensive policy review each January
- **As Needed:** Immediate updates for material changes to data practices
- **Upon Request:** Review triggered by regulatory changes or audit findings

### 8.1 Version History

| Version | Date | Summary of Changes |
|---------|------|-------------------|
| 1.0 | February 2026 | Initial policy publication |

---

## 9. Contact Information

For questions about this policy:

- **Privacy Inquiries:** privacy@myteamnetwork.com
- **Security Concerns:** security@myteamnetwork.com
- **General Support:** support@myteamnetwork.com

---

*Document Version: 1.0*
*Last Updated: February 2026*
