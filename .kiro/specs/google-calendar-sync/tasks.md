# Implementation Plan: Google Calendar Sync

## Overview

This plan implements automatic Google Calendar synchronization for organization events. The implementation follows a bottom-up approach: database schema first, then core services, API routes, and finally UI components.

## Tasks

- [x] 1. Set up database schema and dependencies
  - [x] 1.1 Create database migration for calendar sync tables
    - Create `user_calendar_connections` table with encrypted token fields
    - Create `event_calendar_entries` table for event-to-calendar mapping
    - Create `calendar_sync_preferences` table for user preferences
    - Add RLS policies for all tables
    - _Requirements: 1.3, 2.3, 5.2_
 
  - [x] 1.2 Install googleapis package and add environment variables
    - Add `googleapis` npm package
    - Add Google OAuth credentials to `.env.local.example`
    - _Requirements: 1.2_

  - [x] 1.3 Update database types
    - Regenerate `src/types/database.ts` with new tables
    - _Requirements: 1.3, 2.3, 5.2_

- [x] 2. Implement Google OAuth Handler
  - [x] 2.1 Create OAuth configuration and URL generator
    - Create `src/lib/google/oauth.ts`
    - Implement `getAuthorizationUrl(state)` function
    - Configure scopes for calendar.events only
    - _Requirements: 1.2, 7.4_

  - [x] 2.2 Write property test for OAuth URL generation
    - **Property 1: OAuth Authorization URL Generation**
    - **Validates: Requirements 1.2**

  - [x] 2.3 Implement token exchange and storage
    - Implement `exchangeCodeForTokens(code)` function
    - Implement token encryption using AES-256-GCM
    - Store tokens in `user_calendar_connections`
    - _Requirements: 1.3, 7.3_

  - [x] 2.4 Write property test for token storage
    - **Property 2: Token Storage After OAuth Callback**
    - **Validates: Requirements 1.3**

  - [x] 2.5 Write property test for token encryption
    - **Property 16: Token Encryption**
    - **Validates: Requirements 7.3**

  - [x] 2.6 Implement token refresh logic
    - Implement `refreshAccessToken(refreshToken)` function
    - Handle refresh failures by marking connection as disconnected
    - _Requirements: 7.1, 7.2_

  - [x] 2.7 Write property test for token auto-refresh
    - **Property 15: Token Auto-Refresh**
    - **Validates: Requirements 7.1**

  - [x] 2.8 Implement token revocation
    - Implement `revokeTokens(accessToken)` function
    - _Requirements: 1.6_

- [x] 3. Checkpoint - OAuth handler complete
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. Implement Calendar Sync Service
  - [x] 4.1 Create calendar event CRUD operations
    - Create `src/lib/google/calendar-sync.ts`
    - Implement `createCalendarEvent(accessToken, event)`
    - Implement `updateCalendarEvent(accessToken, googleEventId, event)`
    - Implement `deleteCalendarEvent(accessToken, googleEventId)`
    - _Requirements: 2.1, 3.1, 4.1_

  - [x] 4.2 Write property test for event data mapping
    - **Property 6: Event Data Mapping Completeness**
    - **Validates: Requirements 2.2**

  - [x] 4.3 Implement user targeting logic
    - Create function to get eligible users for an event
    - Filter by organization membership, audience, and sync preferences
    - _Requirements: 2.5, 5.3_

  - [x] 4.4 Write property test for user targeting
    - **Property 5: Event Sync Targets Correct Users**
    - **Validates: Requirements 2.1, 2.5, 5.3**

  - [x] 4.5 Implement sync orchestration
    - Implement `syncEventToUsers(orgId, eventId, operation)`
    - Handle create, update, and delete operations
    - Track sync status in `event_calendar_entries`
    - _Requirements: 2.1, 2.3, 3.1, 4.1_

  - [x] 4.6 Write property test for sync status tracking
    - **Property 7: Sync Status Tracking**
    - **Validates: Requirements 2.3, 2.4, 4.2**

  - [x] 4.7 Implement missing event recovery
    - Handle 404 responses during update by creating new event
    - Update `event_calendar_entries` with new google_event_id
    - _Requirements: 3.3_

  - [x] 4.8 Write property test for missing event recovery
    - **Property 9: Missing Event Recovery**
    - **Validates: Requirements 3.3**

  - [x] 4.9 Implement graceful deletion handling
    - Ensure deletion failures don't block event deletion
    - Log errors but continue processing
    - _Requirements: 4.3_

  - [x] 4.10 Write property test for deletion graceful handling
    - **Property 11: Deletion Failure Graceful Handling**
    - **Validates: Requirements 4.3**

- [x] 5. Checkpoint - Calendar sync service complete
  - Ensure all tests pass, ask the user if questions arise.

- [x] 6. Implement API Routes
  - [x] 6.1 Create OAuth start route
    - Create `src/app/api/google/auth/route.ts`
    - Generate state parameter with user ID
    - Redirect to Google authorization URL
    - _Requirements: 1.2_

  - [x] 6.2 Create OAuth callback route
    - Create `src/app/api/google/callback/route.ts`
    - Validate state parameter
    - Exchange code for tokens
    - Store connection and redirect to settings
    - _Requirements: 1.3_

  - [x] 6.3 Write property test for OAuth error handling
    - **Property 3: OAuth Error Handling**
    - **Validates: Requirements 1.5**

  - [x] 6.4 Create disconnect route
    - Create `src/app/api/google/disconnect/route.ts`
    - Revoke tokens and remove connection
    - _Requirements: 1.6_

  - [x] 6.5 Write property test for disconnect
    - **Property 4: Disconnect Removes Connection**
    - **Validates: Requirements 1.6**

  - [x] 6.6 Create manual sync route
    - Create `src/app/api/calendar/sync/route.ts`
    - Trigger sync for pending events
    - Return sync status
    - _Requirements: 6.4_

  - [x] 6.7 Create sync preferences route
    - Create `src/app/api/calendar/preferences/route.ts`
    - GET and PUT for user sync preferences
    - _Requirements: 5.1, 5.2_

  - [x] 6.8 Write property test for preference storage
    - **Property 12: Preference Storage Round-Trip**
    - **Validates: Requirements 5.2**

- [x] 7. Checkpoint - API routes complete
  - Ensure all tests pass, ask the user if questions arise.

- [x] 8. Integrate sync with event lifecycle
  - [x] 8.1 Add sync trigger to event creation
    - Modify `src/app/[orgSlug]/events/new/page.tsx`
    - Call sync service after successful event insert
    - _Requirements: 2.1_

  - [x] 8.2 Add sync trigger to event update
    - Modify `src/app/[orgSlug]/events/[eventId]/edit/page.tsx`
    - Call sync service after successful event update
    - _Requirements: 3.1_

  - [x] 8.3 Write property test for update propagation
    - **Property 8: Update Propagation**
    - **Validates: Requirements 3.1, 3.2**

  - [x] 8.4 Add sync trigger to event deletion
    - Modify soft delete to trigger calendar deletion
    - _Requirements: 4.1_

  - [x] 8.5 Write property test for deletion propagation
    - **Property 10: Deletion Propagation**
    - **Validates: Requirements 4.1**

  - [x] 8.6 Write property test for preference changes idempotence
    - **Property 13: Preference Changes Idempotence on Past Syncs**
    - **Validates: Requirements 5.4**

- [x] 9. Implement UI Components
  - [x] 9.1 Create CalendarConnectionCard component
    - Create `src/components/settings/CalendarConnectionCard.tsx`
    - Display connection status and Google email
    - Connect/Disconnect buttons
    - Last sync timestamp
    - _Requirements: 1.1, 1.4, 6.1_

  - [x] 9.2 Create SyncPreferencesForm component
    - Create `src/components/settings/SyncPreferencesForm.tsx`
    - Toggles for each event type
    - Save preferences on change
    - _Requirements: 5.1, 5.2_

  - [x] 9.3 Add calendar settings to notification settings page
    - Modify `src/app/settings/notifications/page.tsx`
    - Add CalendarConnectionCard and SyncPreferencesForm
    - _Requirements: 1.1, 5.1, 6.1_

  - [x] 9.4 Write property test for token expiration detection
    - **Property 14: Token Expiration Detection**
    - **Validates: Requirements 6.2, 7.2**

- [x] 10. Final checkpoint
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- All tasks including property tests are required for comprehensive coverage
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties
- Unit tests validate specific examples and edge cases
- The `googleapis` package handles Google Calendar API communication
- Token encryption uses Node.js crypto module with AES-256-GCM
