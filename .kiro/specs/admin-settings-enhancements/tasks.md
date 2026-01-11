# Implementation Plan: Admin Settings Enhancements

## Overview

This plan implements organization name editing, dynamic label propagation, mentorship pair deletion, contact email updates, and UI whitespace optimization. Tasks are ordered to build incrementally with testing integrated throughout.

## Tasks

- [x] 1. Create label resolver utility
  - [x] 1.1 Create `src/lib/navigation/label-resolver.ts` with `resolveLabel()` and `resolveActionLabel()` functions
    - Import ORG_NAV_ITEMS and NavConfig types
    - Implement fallback logic for missing custom labels
    - Handle singular/plural conversion for action labels
    - _Requirements: 2.2, 2.3_
  - [x] 1.2 Write property test for label resolution
    - **Property 4: Nav Label Resolution with Fallback**
    - **Validates: Requirements 2.2, 2.3**

- [x] 2. Add organization name editing to settings page
  - [x] 2.1 Create `validateOrgName()` function in settings page
    - Validate non-empty after trim
    - Validate length ≤ 100 characters
    - Return validation result with error message
    - _Requirements: 1.3, 1.4_
  - [x] 2.2 Write property test for organization name validation
    - **Property 2: Organization Name Validation**
    - **Validates: Requirements 1.3**
  - [x] 2.3 Add organization name input field to settings page
    - Add state for editedOrgName
    - Show editable input for admins, read-only display for non-admins
    - Add save button for name changes
    - _Requirements: 1.1, 1.2_
  - [x] 2.4 Extend `/api/organizations/[organizationId]` PATCH route to handle name updates
    - Accept `name` field in request body
    - Validate admin authorization
    - Update organization name in database
    - Return updated organization
    - _Requirements: 1.5, 1.6_
  - [x] 2.5 Write property test for role-based editability
    - **Property 1: Role-based Organization Name Editability**
    - **Validates: Requirements 1.1, 1.2**

- [x] 3. Checkpoint - Verify settings enhancements
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. Add admin deletion of mentorship pairs
  - [x] 4.1 Add delete button and confirmation to mentorship pair cards
    - Show delete button only for admin users
    - Add confirmation dialog before deletion
    - _Requirements: 3.1, 3.2_
  - [x] 4.2 Implement mentorship pair deletion logic
    - Delete associated mentorship_logs first (cascade)
    - Delete the mentorship_pair record
    - Handle errors and display appropriate messages
    - Update UI state after successful deletion
    - _Requirements: 3.3, 3.4, 3.5_
  - [x] 4.3 Write property test for deletion cascade
    - **Property 5: Mentorship Pair Deletion Cascade**
    - **Validates: Requirements 3.3**
  - [x] 4.4 Write property test for deletion authorization
    - **Property 6: Mentorship Deletion Authorization**
    - **Validates: Requirements 3.6**

- [x] 5. Integrate label resolver into pages
  - [x] 5.1 Update page headers to use resolved labels
    - Modify PageHeader components to accept navConfig
    - Use resolveLabel() for page titles
    - _Requirements: 2.4_
  - [x] 5.2 Update action buttons to use resolved labels
    - Modify "Add X" buttons to use resolveActionLabel()
    - Apply to workouts, events, members, and other list pages
    - _Requirements: 2.4_
  - [x] 5.3 Update empty states to use resolved labels
    - Modify EmptyState messages to use resolved labels
    - _Requirements: 2.4_

- [x] 6. Update contact email
  - [x] 6.1 Update contact email in terms page and landing page
    - Change mckillopm25@gmail.com to support@myteamnetwork.com in src/app/terms/page.tsx
    - Change mckillopm25@gmail.com to support@myteamnetwork.com in src/app/page.tsx
    - _Requirements: 4.1, 4.2, 4.3_

- [x] 7. Optimize settings page whitespace
  - [x] 7.1 Reduce padding and margins in settings page
    - Adjust Card padding from p-6 to p-5 where appropriate
    - Reduce gap between sections from gap-6 to gap-5
    - Tighten button spacing
    - _Requirements: 5.1, 5.2_
  - [x] 7.2 Ensure responsive spacing is maintained
    - Verify mobile touch targets remain accessible
    - Test on various screen sizes
    - _Requirements: 5.3, 5.4_

- [x] 8. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- All tasks including property tests are required
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties
- Unit tests validate specific examples and edge cases
