# COPPA Age Gate Design Document

## Overview

This document describes the implementation of a "Neutral Age Gate" to comply with COPPA requirements while maintaining FERPA data minimization principles.

## 1. UI Design

### Step 0: Date of Birth Screen

**Layout:**
- Clean, single-purpose screen with DOB input
- Three dropdown/input fields: Month, Day, Year
- "Continue" button (disabled until valid date entered)
- No messaging about age requirements

**Neutrality Rule:**
The form MUST NOT indicate age requirements. Users should not see:
- "You must be 13 or older"
- "This site is for users 13+"
- Any age-related warnings

This prevents children from lying about their age to bypass the gate.

**Example UI:**

```
+-----------------------------------------------+
|           Create your account                 |
|                                               |
|    To get started, please enter your          |
|    date of birth:                             |
|                                               |
|    Month: [v]   Day: [v]   Year: [v]          |
|                                               |
|              [ Continue ]                     |
|                                               |
|    Already have an account? Sign in           |
+-----------------------------------------------+
```

---

## 2. Age Calculation Logic

**Client-side calculation:**

```typescript
function calculateAge(birthDate: Date): number {
  const today = new Date();
  let age = today.getFullYear() - birthDate.getFullYear();
  const monthDiff = today.getMonth() - birthDate.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
    age--;
  }
  return age;
}
```

**Decision Tree:**
- If age >= 13: Proceed to Step 1 (normal signup)
- If age < 13: Redirect to `/auth/parental-consent` (to be built)

---

## 3. Data Strategy (CRITICAL)

### What We Store

- `is_minor: boolean` - True if user was under 18 at signup
- `age_bracket: string` - One of: `"under_13"`, `"13_17"`, `"18_plus"`

### What We DO NOT Store

- Date of Birth (day, month, year)
- Exact age in years

### Rationale

FERPA Data Minimization: We committed in `docs/Data_Inventory.md` to NOT collect Date of Birth. The age gate uses DOB only transiently to calculate age bracket, then discards it.

### Implementation

```typescript
// Transient calculation (client-side only)
const dob = new Date(year, month - 1, day);
const age = calculateAge(dob);

// Derived data (stored in user metadata)
const ageBracket = age < 13 ? "under_13" : age < 18 ? "13_17" : "18_plus";
const isMinor = age < 18;

// DOB is NEVER sent to server or stored
```

---

## 4. OAuth Handling

**Approach:** Age gate first, before any signup options.

**Flow:**
1. User lands on `/auth/signup`
2. Step 0: DOB collection screen (no OAuth buttons visible)
3. If age >= 13: Show Step 1 with email form AND Google OAuth button
4. If age < 13: Redirect to parental consent (no OAuth offered)

**Rationale:**
- Prevents children from bypassing age gate via OAuth
- Google may provide DOB in profile - we avoid receiving it entirely
- Cleaner UX: one decision path before showing options

---

## 5. Parental Consent Redirect

When age < 13, redirect to:

```
/auth/parental-consent?source=signup
```

This page (to be built later) will:
1. Explain that parental consent is required
2. Collect parent email address
3. Send verification to parent
4. Await parental approval before account creation

---

## 6. Session Handling

The age bracket must persist across the signup flow:
- Store in session storage (client-side, temporary)
- Pass to signup API in user metadata
- Clear after successful signup

**Implementation:**

```typescript
// After age gate validation
sessionStorage.setItem("signup_age_bracket", ageBracket);
sessionStorage.setItem("signup_is_minor", String(isMinor));

// On signup form submission
const ageBracket = sessionStorage.getItem("signup_age_bracket");
const isMinor = sessionStorage.getItem("signup_is_minor") === "true";

// Include in user metadata during account creation
const { data, error } = await supabase.auth.signUp({
  email,
  password,
  options: {
    data: {
      full_name: name,
      age_bracket: ageBracket,
      is_minor: isMinor,
    },
  },
});

// Clear after successful signup
sessionStorage.removeItem("signup_age_bracket");
sessionStorage.removeItem("signup_is_minor");
```

---

## 7. Security Considerations

### Rate Limiting
- Rate limit DOB submissions to prevent age enumeration attacks
- Suggested limit: 5 attempts per IP per 10 minutes

### Audit Logging
- Log age gate events for compliance auditing
- Log ONLY: timestamp, result (passed/redirected), age_bracket
- NEVER log: DOB values

### Server-Side Validation
- Validate age bracket server-side on account creation
- Reject signups without valid age_bracket in metadata
- Prevent direct API calls that bypass the age gate

### Session Security
- Use sessionStorage (not localStorage) for transient data
- Data cleared automatically when browser tab closes
- Additional manual clear on signup completion

---

## 8. Multi-Step Form Architecture

### Component Structure

```
src/app/auth/signup/
  page.tsx                 # Server component (unchanged)
  SignupClient.tsx         # Refactored to multi-step

src/components/auth/
  AgeGate.tsx              # New: DOB collection component
  SignupForm.tsx           # Extracted: existing form fields
```

### State Management

```typescript
type SignupStep = "age_gate" | "registration";

interface SignupState {
  step: SignupStep;
  ageBracket: string | null;
  isMinor: boolean | null;
}
```

### Flow Diagram

```
[User visits /auth/signup]
           |
           v
    [Step 0: AgeGate]
           |
     (calculates age)
           |
    +------+------+
    |             |
    v             v
 age >= 13     age < 13
    |             |
    v             v
[Step 1:     [Redirect to
SignupForm]   /auth/parental-consent]
```

---

## 9. Validation Schema

Add to `src/lib/schemas/auth.ts`:

```typescript
import { z } from "zod";

export const ageGateSchema = z.object({
  month: z.number().int().min(1).max(12),
  day: z.number().int().min(1).max(31),
  year: z.number().int().min(1900).max(new Date().getFullYear()),
}).refine((data) => {
  // Validate the date is real (e.g., not Feb 30)
  const date = new Date(data.year, data.month - 1, data.day);
  return (
    date.getFullYear() === data.year &&
    date.getMonth() === data.month - 1 &&
    date.getDate() === data.day
  );
}, {
  message: "Please enter a valid date",
});

export type AgeGateForm = z.infer<typeof ageGateSchema>;
```

---

## 10. Database Schema Changes

Add migration for user metadata tracking:

```sql
-- Migration: Add age_bracket tracking
-- Note: age_bracket stored in auth.users.raw_user_meta_data (Supabase Auth)
-- No separate table needed for initial implementation

-- For compliance auditing, create audit log table:
CREATE TABLE IF NOT EXISTS compliance_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type TEXT NOT NULL,
  age_bracket TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ip_hash TEXT, -- Hashed IP for rate limiting without storing raw IP

  CONSTRAINT valid_event_type CHECK (event_type IN ('age_gate_passed', 'age_gate_redirected'))
);

-- Index for rate limiting queries
CREATE INDEX idx_compliance_audit_ip_time ON compliance_audit_log (ip_hash, created_at);

-- RLS: Only service role can write
ALTER TABLE compliance_audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role only" ON compliance_audit_log
  FOR ALL USING (false);
```

---

## 11. Files to Create/Modify

| File | Action | Description |
|------|--------|-------------|
| `src/components/auth/AgeGate.tsx` | CREATE | DOB collection component |
| `src/lib/schemas/auth.ts` | EDIT | Add `ageGateSchema` |
| `src/app/auth/signup/SignupClient.tsx` | EDIT | Refactor to multi-step |
| `src/app/auth/parental-consent/page.tsx` | CREATE | Placeholder for consent flow |
| `supabase/migrations/YYYYMMDD_age_gate_audit.sql` | CREATE | Audit log table |

---

## 12. Testing Requirements

### Unit Tests
- Age calculation accuracy (edge cases: leap years, today's birthday)
- Schema validation (invalid dates rejected)
- Session storage operations

### Integration Tests
- Full signup flow with age >= 13
- Redirect flow with age < 13
- OAuth blocked until age gate passed

### E2E Tests
- Complete signup journey
- Under-13 redirect behavior
- Session persistence across steps

---

## 13. Acceptance Criteria

1. Users cannot see signup form or OAuth options until DOB is entered
2. No age-related messaging appears on the age gate screen
3. DOB is never transmitted to the server
4. Users under 13 are redirected to parental consent page
5. age_bracket is stored in user metadata on account creation
6. Audit log captures gate events without storing DOB
7. Rate limiting prevents age enumeration attacks
