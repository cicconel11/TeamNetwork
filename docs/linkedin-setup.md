# LinkedIn Integration Setup

This guide covers configuring the LinkedIn OAuth integration for development and production environments.

## LinkedIn App Setup

1. Go to [LinkedIn Developer Portal](https://developer.linkedin.com/) and create a new app
2. Under **Products**, add **"Sign In with LinkedIn using OpenID Connect"**
3. Required scopes: `openid`, `profile`, `email`
4. Under the **Auth** tab, add redirect URIs for each environment (see table below)

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `LINKEDIN_CLIENT_ID` | Yes | OAuth client ID from LinkedIn app |
| `LINKEDIN_CLIENT_SECRET` | Yes | OAuth client secret |
| `LINKEDIN_TOKEN_ENCRYPTION_KEY` | Yes | 64-hex-char key for AES-256-GCM token encryption |

Generate the encryption key:

```bash
openssl rand -hex 32
```

All three variables must be set together. Setting only 1-2 will produce a build warning about partial LinkedIn config.

`LINKEDIN_REDIRECT_URI` is **not** an env var — it is computed at runtime as `{NEXT_PUBLIC_SITE_URL}/api/linkedin/callback`.

## Redirect URI Configuration

Register these redirect URIs in the LinkedIn Developer Console for each environment:

| Environment | Redirect URI |
|---|---|
| Local dev | `http://localhost:3000/api/linkedin/callback` |
| Preview/staging | `https://{branch}.vercel.app/api/linkedin/callback` |
| Production | `https://www.myteamnetwork.com/api/linkedin/callback` |

## Local Testing

1. Set the 3 env vars in `.env.local`
2. In the LinkedIn Developer Console, add `http://localhost:3000/api/linkedin/callback` as a redirect URI
3. Run `npm run dev`
4. Navigate to `/settings/connected-accounts` and click **"Connect LinkedIn"**
5. Authorize in the LinkedIn popup
6. Verify redirect back to settings with synced profile data

## Manual URL vs Verified Sync

These are two independent features:

- **Manual URL**: Users paste a LinkedIn profile URL on their member/alumni profile. Stored as `linkedin_url` in `members`/`alumni` tables. Display-only, not verified.
- **Verified sync**: OAuth connection syncs `given_name`, `family_name`, `email`, `picture` from LinkedIn's OIDC userinfo endpoint. Stored in `user_linkedin_connections` table with encrypted tokens.

Connecting LinkedIn does NOT auto-populate the profile URL, and vice versa. The UI explains this distinction.

## OIDC Limitations (MVP)

The integration uses standard OpenID Connect scopes only (`openid profile email`).
We do not request `offline_access` (not generally available to standard LinkedIn developer apps as of April 2026), so treat the connection as reconnect-required after the access token expires.

**Returns:** `sub`, `given_name`, `family_name`, `email`, `picture`, `email_verified`, `locale`

**Does NOT return:** headline, vanity URL, company, connections count. These require the Marketing API or partner-level access.

Other limitations:
- No token revocation endpoint — disconnect deletes the local record only
- If LinkedIn expires the access token and does not issue a refresh token, the user must reconnect

### ID Token Shortcut

With `openid` in scope, LinkedIn returns a signed JWT `id_token` alongside the access token. The ID token already contains the userinfo claims (`sub`, `given_name`, `family_name`, `email`, `picture`), so a successful initial login does not strictly require a `/v2/userinfo` call. We still call userinfo for re-sync to pick up any server-side updates.

### Scopes We Do Not Request

For clarity during feature reviews, we intentionally do **not** request:

- `w_member_social` (posting to LinkedIn on the member's behalf)
- `r_ads`, `r_organization_social` (Marketing APIs — require Marketing Developer Platform partner access)
- `r_liteprofile`, `r_emailaddress` (legacy, deprecated in favor of `openid profile email`)

## API Operations

| Operation | Endpoint | Description |
|---|---|---|
| Re-sync | `POST /api/linkedin/sync` | Fetches fresh profile from userinfo endpoint |
| Disconnect | `POST /api/linkedin/disconnect` | Deletes the DB record (no remote revocation) |
| Token refresh | Best effort | `getValidLinkedInToken()` refreshes expired access tokens when a refresh token is present. On failure, status is set to `error` and the user is prompted to reconnect. |

### Error Status

A connection is marked `error` if token refresh fails or profile fetch fails. Re-syncing clears transient profile-fetch errors; reconnecting remains the fallback for token failures that cannot be recovered.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| "Missing required environment variable" on connect | Env var not set | Set all 3 LinkedIn env vars |
| "There is a server configuration issue" | Partial env config | Ensure all 3 vars are set together |
| Redirect URI mismatch error from LinkedIn | URI not registered | Add exact callback URL in LinkedIn dev console |
| Connection status shows "error" after a temporary LinkedIn outage | Profile fetch failed transiently | Click **Sync Now** to retry and clear the error state |
| Connection status shows "error" and sync keeps failing | Token refresh failed, or no refresh token was available after expiry | Reconnect LinkedIn |
| Profile photo not loading | CSP blocking `media.licdn.com` | Already added to CSP in `next.config.mjs` |
| Build warning about partial LinkedIn config | Only 1-2 of 3 vars set | Set all 3 or none |

## Route Architecture

Two route sets currently exist for LinkedIn:

- **`/api/linkedin/*`** — Primary OAuth routes (`auth`, `callback`, `disconnect`, `sync`). Used by `/settings/connected-accounts`.
- **`/api/user/linkedin/*`** — Alternate routes with `status`/`url` endpoints. Used by `/settings/linkedin`.

### Consolidation Plan

Canonical path: **`/api/linkedin/*`** (already registered with LinkedIn as the OAuth callback URL — moving it would require redirect-URI updates across every environment).

Migration steps:

1. Move `status` and `url` handlers under `/api/linkedin/status` and `/api/linkedin/url`.
2. Leave `/api/user/linkedin/*` as thin re-export wrappers for one release with a `console.warn` deprecation note.
3. Update `/settings/linkedin` and `/settings/connected-accounts` callers to the canonical paths.
4. Delete the wrappers the following release.

## Content Security Policy

The following directives are required in `next.config.mjs`:

```text
img-src 'self' data: blob: https://media.licdn.com https://static.licdn.com
connect-src 'self' https://api.linkedin.com https://www.linkedin.com
```

`media.licdn.com` hosts profile photos; `static.licdn.com` hosts widget assets (allowlisted preemptively in case a LinkedIn-hosted widget is added). `api.linkedin.com` is used by server-side token refresh / userinfo calls.
