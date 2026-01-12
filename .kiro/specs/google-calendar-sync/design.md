# Design Document: Google Calendar Sync

## Overview

This design describes the implementation of automatic Google Calendar synchronization for organization events. When admins create, update, or delete events, the system will automatically sync those changes to the Google Calendars of users who have connected their accounts.

The implementation uses Google's OAuth 2.0 for user authentication and the Google Calendar API (v3) via the `googleapis` npm package for calendar operations. The sync process runs asynchronously to avoid blocking event creation/updates.

## Architecture

```mermaid
flowchart TB
    subgraph Frontend
        Settings[User Settings Page]
        EventForm[Event Create/Edit Form]
    end
    
    subgraph API Routes
        OAuthStart[/api/google/auth]
        OAuthCallback[/api/google/callback]
        SyncAPI[/api/calendar/sync]
        DisconnectAPI[/api/google/disconnect]
    end
    
    subgraph Services
        OAuthHandler[Google OAuth Handler]
        CalendarSync[Calendar Sync Service]
    end
    
    subgraph External
        GoogleAuth[Google OAuth Server]
        GoogleCalAPI[Google Calendar API]
    end
    
    subgraph Database
        UserCalConn[(user_calendar_connections)]
        EventCalEntry[(event_calendar_entries)]
        SyncPrefs[(calendar_sync_preferences)]
    end
    
    Settings --> OAuthStart
    OAuthStart --> OAuthHandler
    OAuthHandler --> GoogleAuth
    GoogleAuth --> OAuthCallback
    OAuthCallback --> UserCalConn
    
    EventForm --> CalendarSync
    CalendarSync --> GoogleCalAPI
    CalendarSync --> EventCalEntry
    
    Settings --> DisconnectAPI
    DisconnectAPI --> UserCalConn
```

## Components and Interfaces

### 1. Google OAuth Handler (`src/lib/google/oauth.ts`)

Manages the OAuth 2.0 flow for connecting user Google accounts.

```typescript
interface GoogleOAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  scopes: string[];
}

interface TokenResponse {
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
  email: string;
}

// Generate authorization URL for user consent
function getAuthorizationUrl(state: string): string;

// Exchange authorization code for tokens
async function exchangeCodeForTokens(code: string): Promise<TokenResponse>;

// Refresh an expired access token
async function refreshAccessToken(refreshToken: string): Promise<TokenResponse>;

// Revoke tokens when user disconnects
async function revokeTokens(accessToken: string): Promise<void>;
```

### 2. Calendar Sync Service (`src/lib/google/calendar-sync.ts`)

Handles all Google Calendar API operations for event synchronization.

```typescript
interface CalendarEvent {
  summary: string;
  description?: string;
  location?: string;
  start: { dateTime: string; timeZone: string };
  end: { dateTime: string; timeZone: string };
}

interface SyncResult {
  success: boolean;
  googleEventId?: string;
  error?: string;
}

// Create a new event in user's Google Calendar
async function createCalendarEvent(
  accessToken: string,
  event: CalendarEvent
): Promise<SyncResult>;

// Update an existing event in user's Google Calendar
async function updateCalendarEvent(
  accessToken: string,
  googleEventId: string,
  event: CalendarEvent
): Promise<SyncResult>;

// Delete an event from user's Google Calendar
async function deleteCalendarEvent(
  accessToken: string,
  googleEventId: string
): Promise<SyncResult>;

// Sync an organization event to all connected users
async function syncEventToUsers(
  organizationId: string,
  eventId: string,
  operation: 'create' | 'update' | 'delete'
): Promise<void>;
```

### 3. API Routes

#### OAuth Start (`src/app/api/google/auth/route.ts`)
- Generates OAuth authorization URL with state parameter
- Redirects user to Google consent screen

#### OAuth Callback (`src/app/api/google/callback/route.ts`)
- Receives authorization code from Google
- Exchanges code for tokens
- Stores tokens in `user_calendar_connections`
- Redirects back to settings page

#### Disconnect (`src/app/api/google/disconnect/route.ts`)
- Revokes Google tokens
- Removes `user_calendar_connections` record
- Cleans up related `event_calendar_entries`

#### Manual Sync (`src/app/api/calendar/sync/route.ts`)
- Triggers immediate sync of pending events
- Returns sync status

### 4. UI Components

#### CalendarConnectionCard (`src/components/settings/CalendarConnectionCard.tsx`)
- Displays connection status
- Shows connected Google email
- Connect/Disconnect buttons
- Last sync timestamp
- Sync preferences toggles

## Data Models

### user_calendar_connections
Stores OAuth tokens and connection status for each user.

```sql
CREATE TABLE user_calendar_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  google_email TEXT NOT NULL,
  access_token_encrypted TEXT NOT NULL,
  refresh_token_encrypted TEXT NOT NULL,
  token_expires_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'connected' CHECK (status IN ('connected', 'disconnected', 'error')),
  last_sync_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id)
);
```

### event_calendar_entries
Maps organization events to Google Calendar event IDs per user.

```sql
CREATE TABLE event_calendar_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  google_event_id TEXT NOT NULL,
  sync_status TEXT NOT NULL DEFAULT 'synced' CHECK (sync_status IN ('pending', 'synced', 'failed', 'deleted')),
  last_error TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(event_id, user_id)
);
```

### calendar_sync_preferences
Stores user preferences for which event types to sync.

```sql
CREATE TABLE calendar_sync_preferences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  sync_general BOOLEAN DEFAULT true,
  sync_game BOOLEAN DEFAULT true,
  sync_meeting BOOLEAN DEFAULT true,
  sync_social BOOLEAN DEFAULT true,
  sync_fundraiser BOOLEAN DEFAULT true,
  sync_philanthropy BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, organization_id)
);
```



## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system—essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: OAuth Authorization URL Generation

*For any* state parameter, the generated OAuth authorization URL SHALL contain the correct client ID, redirect URI, required scopes (calendar.events), and the provided state parameter.

**Validates: Requirements 1.2**

### Property 2: Token Storage After OAuth Callback

*For any* valid authorization code received from Google, exchanging it for tokens SHALL result in a `user_calendar_connections` record being created with encrypted tokens, the user's Google email, and status "connected".

**Validates: Requirements 1.3**

### Property 3: OAuth Error Handling

*For any* OAuth error response (invalid code, user denial, network error), the system SHALL return an error object with a user-friendly message and NOT create a connection record.

**Validates: Requirements 1.5**

### Property 4: Disconnect Removes Connection

*For any* connected user who initiates disconnect, the system SHALL revoke their Google tokens and remove their `user_calendar_connections` record, resulting in no connection existing for that user.

**Validates: Requirements 1.6**

### Property 5: Event Sync Targets Correct Users

*For any* organization event with a given audience setting and event type, the sync operation SHALL create calendar entries ONLY for users who:
1. Have a connected Google Calendar in that organization
2. Are eligible based on the event's audience (members, alumni, both, or specific users)
3. Have the event's type enabled in their sync preferences

**Validates: Requirements 2.1, 2.5, 5.3**

### Property 6: Event Data Mapping Completeness

*For any* organization event being synced, the resulting Google Calendar event SHALL contain:
- summary equal to event.title
- description equal to event.description (if present)
- location equal to event.location (if present)
- start.dateTime equal to event.start_date
- end.dateTime equal to event.end_date (or start_date + 1 hour if no end_date)

**Validates: Requirements 2.2**

### Property 7: Sync Status Tracking

*For any* sync operation:
- If the Google Calendar API returns success, the `event_calendar_entries` record SHALL have sync_status "synced"
- If the Google Calendar API returns an error, the record SHALL have sync_status "failed" and last_error populated
- If a deletion succeeds, the record SHALL have sync_status "deleted"

**Validates: Requirements 2.3, 2.4, 4.2**

### Property 8: Update Propagation

*For any* event update, the system SHALL update all existing `event_calendar_entries` for that event by using the stored google_event_id to locate and update the corresponding Google Calendar events.

**Validates: Requirements 3.1, 3.2**

### Property 9: Missing Event Recovery

*For any* update operation where the Google Calendar event no longer exists (404 response), the system SHALL create a new Google Calendar event and update the `event_calendar_entries` record with the new google_event_id.

**Validates: Requirements 3.3**

### Property 10: Deletion Propagation

*For any* soft-deleted organization event, the system SHALL attempt to delete all corresponding Google Calendar events for all users with `event_calendar_entries` for that event.

**Validates: Requirements 4.1**

### Property 11: Deletion Failure Graceful Handling

*For any* Google Calendar deletion that fails, the system SHALL log the error but SHALL NOT throw an exception or block the organization event deletion.

**Validates: Requirements 4.3**

### Property 12: Preference Storage Round-Trip

*For any* valid combination of sync preferences (6 boolean values for event types), storing and then retrieving the preferences SHALL return the same values.

**Validates: Requirements 5.2**

### Property 13: Preference Changes Idempotence on Past Syncs

*For any* user who changes their sync preferences, the set of `event_calendar_entries` for events created BEFORE the preference change SHALL remain unchanged.

**Validates: Requirements 5.4**

### Property 14: Token Expiration Detection

*For any* API call that returns a 401 Unauthorized error, the system SHALL attempt token refresh. If refresh fails, the `user_calendar_connections` status SHALL be set to "disconnected".

**Validates: Requirements 6.2, 7.2**

### Property 15: Token Auto-Refresh

*For any* API call where the access token has expired but the refresh token is valid, the system SHALL automatically obtain a new access token and retry the operation successfully.

**Validates: Requirements 7.1**

### Property 16: Token Encryption

*For any* `user_calendar_connections` record, the access_token_encrypted and refresh_token_encrypted fields SHALL NOT contain plaintext tokens (they must be encrypted).

**Validates: Requirements 7.3**

## Error Handling

### OAuth Errors
| Error | Handling |
|-------|----------|
| User denies consent | Redirect to settings with `error=access_denied` query param, display friendly message |
| Invalid/expired authorization code | Redirect to settings with `error=invalid_code`, prompt to retry |
| Network error during token exchange | Redirect with `error=network_error`, allow retry |
| Invalid client credentials | Log error, display generic "configuration error" message |

### Calendar API Errors
| Error | Handling |
|-------|----------|
| 401 Unauthorized | Attempt token refresh; if fails, mark connection as disconnected |
| 403 Forbidden | Log error, mark sync as failed, notify user of permission issue |
| 404 Not Found (on update/delete) | For update: create new event; For delete: mark as deleted |
| 429 Rate Limited | Implement exponential backoff, retry up to 3 times |
| 500/503 Server Error | Retry with backoff, mark as failed after 3 attempts |

### Token Refresh Errors
| Error | Handling |
|-------|----------|
| Invalid refresh token | Mark connection as disconnected, prompt user to reconnect |
| Revoked access | Mark connection as disconnected, clear tokens |
| Network error | Retry once, then mark sync as failed (don't disconnect) |

## Testing Strategy

### Unit Tests
Unit tests verify specific examples and edge cases:

- OAuth URL generation with various state values
- Token encryption/decryption round-trip
- Event data mapping for events with/without optional fields
- Audience filtering logic for each audience type
- Preference filtering for each event type combination
- Error message generation for each error type

### Property-Based Tests
Property tests verify universal properties across generated inputs using `fast-check`:

- **Property 1**: Generate random state strings, verify URL contains all required components
- **Property 5**: Generate random events with various audiences and user sets, verify correct targeting
- **Property 6**: Generate random event objects, verify all fields map correctly
- **Property 7**: Generate random API responses, verify status tracking is correct
- **Property 12**: Generate random preference combinations, verify round-trip consistency
- **Property 13**: Generate random preference change sequences, verify past syncs unchanged
- **Property 16**: Generate random tokens, verify encrypted values differ from plaintext

### Integration Tests
- Full OAuth flow with mocked Google responses
- Event creation triggering sync to multiple users
- Event update propagating to existing calendar entries
- Event deletion cleaning up calendar entries
- Token refresh during API call
- Disconnect flow removing all user data

### Test Configuration
- Property tests: minimum 100 iterations per property
- Use `fast-check` for property-based testing
- Mock Google APIs using `nock` or similar
- Tag format: **Feature: google-calendar-sync, Property {number}: {property_text}**
