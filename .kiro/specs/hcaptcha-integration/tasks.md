# Implementation Plan: hCaptcha Integration

## Overview

This implementation plan adds hCaptcha bot protection to the TeamNetwork application. Tasks are organized to build foundational components first, then integrate them into existing forms.

## Tasks

- [x] 1. Install dependencies and configure environment
  - Install `@hcaptcha/react-hcaptcha` package
  - Add `NEXT_PUBLIC_HCAPTCHA_SITE_KEY` and `HCAPTCHA_SECRET_KEY` to `.env.local.example`
  - Update `.env.local` documentation
  - _Requirements: 7.1, 7.2_

- [x] 2. Create server-side captcha verification utility
  - [x] 2.1 Implement `verifyCaptcha` function in `src/lib/security/captcha.ts`
    - POST to `https://api.hcaptcha.com/siteverify`
    - Handle timeout (3 second default)
    - Support development mode bypass
    - Return structured result with error codes
    - _Requirements: 2.1, 2.4, 2.5_
  - [x] 2.2 Write property test for missing token rejection
    - **Property 2: Missing Token Rejection**
    - **Validates: Requirements 2.2**
  - [x] 2.3 Write property test for invalid token rejection
    - **Property 3: Invalid Token Rejection**
    - **Validates: Requirements 2.3**
  - [x] 2.4 Write property test for verification timeout
    - **Property 4: Verification Timeout Enforcement**
    - **Validates: Requirements 2.5**

- [x] 3. Create HCaptcha React component
  - [x] 3.1 Implement `HCaptcha` component in `src/components/ui/HCaptcha.tsx`
    - Wrap `@hcaptcha/react-hcaptcha`
    - Auto-load site key from environment
    - Support light/dark themes
    - Handle loading and error states
    - Forward ref for programmatic control
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 8.1, 8.3_
  - [x] 3.2 Export component from `src/components/ui/index.ts`
    - _Requirements: 1.1_
  - [x] 3.3 Write property test for token callback
    - **Property 1: Token Callback Invocation**
    - **Validates: Requirements 1.2**

- [x] 4. Create useCaptcha hook
  - [x] 4.1 Implement `useCaptcha` hook in `src/hooks/useCaptcha.ts`
    - Manage token state
    - Provide onVerify, onExpire, onError callbacks
    - Provide reset function
    - Track isVerified and isLoading states
    - _Requirements: 1.2, 1.3_
  - [x] 4.2 Export hook from `src/hooks/index.ts`
    - _Requirements: 1.2_

- [x] 5. Checkpoint - Verify core components
  - Ensure all tests pass, ask the user if questions arise.

- [x] 6. Integrate captcha into Login form
  - [x] 6.1 Update `src/app/auth/login/page.tsx`
    - Add HCaptcha component to form
    - Use useCaptcha hook for state management
    - Disable submit button until verified
    - Pass captcha token to authentication calls
    - _Requirements: 3.1, 3.2, 3.3, 3.4_
  - [x] 6.2 Write property test for login form submission
    - **Property 5: Protected Form Submission Requires Token**
    - **Validates: Requirements 3.1, 3.2**
  - [x] 6.3 Write property test for submit button state
    - **Property 6: Submit Button Disabled Until Verified**
    - **Validates: Requirements 3.4**

- [x] 7. Integrate captcha into Signup form
  - [x] 7.1 Update `src/app/auth/signup/page.tsx`
    - Add HCaptcha component to form
    - Use useCaptcha hook for state management
    - Disable submit button until verified
    - Pass captcha token to signup call
    - _Requirements: 4.1, 4.2, 4.3_

- [x] 8. Integrate captcha into Join Organization form
  - [x] 8.1 Update `src/app/app/join/page.tsx`
    - Add HCaptcha component to form
    - Use useCaptcha hook for state management
    - Handle both manual code entry and token URL flows
    - Disable submit button until verified
    - _Requirements: 5.1, 5.2, 5.3_

- [x] 9. Integrate captcha into Donation form
  - [x] 9.1 Update `src/components/donations/DonationForm.tsx`
    - Add HCaptcha component to form
    - Use useCaptcha hook for state management
    - Disable submit button until verified
    - Pass captcha token to donation API
    - _Requirements: 6.1, 6.2, 6.3_
  - [x] 9.2 Update `src/app/api/stripe/create-donation/route.ts`
    - Add captcha token validation to request schema
    - Verify captcha token before creating checkout session
    - Return appropriate error codes for missing/invalid tokens
    - _Requirements: 2.2, 2.3, 6.1_

- [x] 10. Checkpoint - Verify form integrations
  - Ensure all tests pass, ask the user if questions arise.

- [x] 11. Add environment validation
  - [x] 11.1 Create environment validation in `src/lib/env.ts`
    - Validate HCAPTCHA_SECRET_KEY in production
    - Log warning in development if keys missing
    - Export helper to check if captcha is enabled
    - _Requirements: 7.3, 7.4_

- [x] 12. Final checkpoint - Complete integration
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties
- Unit tests validate specific examples and edge cases
- The `@hcaptcha/react-hcaptcha` package handles accessibility (keyboard navigation, ARIA) internally
