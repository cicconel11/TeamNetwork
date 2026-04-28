# Runbook: User stuck on email signup confirmation

When a user reports they cannot complete signup because the confirmation email
either never arrived or its link expired before they clicked it.

## 1. Confirm the symptom

Ask:
- The exact email they signed up with
- Whether they ever received any confirmation email (vs. nothing at all)
- Whether the link they clicked said "expired" or just failed silently

## 2. Self-service path (try first)

Send the user to **`/auth/link-expired`** and ask them to:
1. Enter their email
2. Complete the captcha
3. Click "Resend confirmation email"

This works after the in-product fix (PR shipping with this runbook). If the
form responds successfully but no email arrives within ~5 minutes, escalate.

## 3. Manual unblock (admin-only)

Required: Supabase service-role access via the Studio dashboard.

### Option A — manually mark email confirmed (fastest)

1. Open Supabase Studio → Authentication → Users
2. Search by the user's email
3. If `email_confirmed_at` is `NULL`:
   - Click the user → "Confirm email" action, **or**
   - Run SQL:
     ```sql
     update auth.users
     set email_confirmed_at = now()
     where email = '<user-email>';
     ```
4. Tell the user they can now log in directly at `/auth/login`

### Option B — generate a fresh confirmation link

In the Studio SQL editor or via a one-off script using the service-role key:

```ts
import { createClient } from "@supabase/supabase-js";
const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
const { data, error } = await admin.auth.admin.generateLink({
  type: "signup",
  email: "<user-email>",
});
// Send data.properties.action_link to the user out-of-band
```

Use this when the account requires the standard confirmation flow (age gate,
ToS acceptance, etc.) to fire and you don't want to bypass it.

## 4. Verify follow-up state

After confirmation, double-check:
- The user can log in at `/auth/login`
- They land on `/app` (or `/auth/accept-terms` if pending)
- Their org membership / invite status is intact:
  ```sql
  select * from user_organization_roles where user_id = '<auth.users.id>';
  ```

## 5. If the email truly never arrives

Likely Hotmail/Outlook deliverability — Supabase's default SMTP has weak
reputation with Microsoft mailboxes. Mitigations (in priority order):

1. Ask the user to check spam/junk + the Outlook "Other" inbox tab
2. Switch them temporarily to a Gmail/Apple/iCloud address (workaround)
3. Long-term: configure custom SMTP in Supabase Dashboard pointing at Resend
   (see plan in `~/.claude/plans/one-of-our-users-stateful-treasure.md`,
   section 3). `RESEND_API_KEY` is already configured for transactional mail.

## 6. Logging

Each manual unblock should be noted in the support log with:
- Date, user email, action taken (Option A vs B), responder
- Whether the user confirmed login worked
