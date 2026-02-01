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

* [x] **ACTION:** Audit completed. Registration flow audited - implementing Neutral Age Gate to identify <13 users.

> **Note:** Implementing Neutral Age Gate per `docs/compliance_plans/COPPA_Age_Gate_Plan.md`. The age gate collects DOB transiently to calculate `age_bracket` ("under_13", "13_17", "18_plus") without permanently storing Date of Birth, maintaining FERPA Data Minimization principles.

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

* [ ] **Consent Workflow:** Build a UI flow that:
    1.  Notifies the parent (Email/SMS).
    2.  Obtains verifiable consent (e.g., Credit Card auth, Government ID check, Signed form, Video call).
    3.  Stores the consent record securely.

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
* [ ] **Encryption:** Align with industry standards (AES-256, TLS 1.3).
* [ ] **Access:** Restrict internal employee access to children's data.
* [ ] **Breach Plan:** Have a specific response plan for breaches involving minor's data.

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
- [ ] Age Gate Implemented - See `docs/compliance_plans/COPPA_Age_Gate_Plan.md`
- [ ] Parental Notice Workflow Active
- [ ] Verifiable Consent Mechanism Active
- [ ] Limited Data Collection Enforced
- [ ] Privacy Policy Updated for <13
- [ ] Security Safeguards Verified
- [ ] Parental Access/Delete Tools Ready
- [ ] Staff Training Completed