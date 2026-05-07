<wizard-report>
# PostHog post-wizard report

The wizard has completed a deep integration of PostHog analytics into the TeamMeet mobile app. PostHog (`posthog-react-native` v4.22.0) was already installed. The existing analytics abstraction layer (`src/lib/analytics/`) was extended rather than replaced — all new event calls route through `analytics.track()`, which batches and forwards to PostHog. The PostHog client was updated to read its host URL from `EXPO_PUBLIC_POSTHOG_HOST` (previously hardcoded). Environment variables were written to `.env.local`. Eight targeted event tracking calls were added across seven files, covering the full auth lifecycle, key admin actions, and core engagement flows.

| Event | Description | File |
|---|---|---|
| `user_signed_up` | User completes email registration | `app/(auth)/signup.tsx` |
| `user_logged_in` | User signs in with email and password | `app/(auth)/login.tsx` |
| `user_logged_in_with_google` | User signs in via Google OAuth | `app/(auth)/login.tsx` |
| `event_cancelled` | Admin soft-deletes an org event | `app/(app)/(drawer)/[orgSlug]/events/[eventId]/index.tsx` |
| `event_check_in_completed` | Admin checks in an attendee at an event | `app/(app)/(drawer)/[orgSlug]/events/check-in.tsx` |
| `donation_checkout_started` | Donor is redirected to Stripe Checkout | `app/(app)/(drawer)/[orgSlug]/donations/new.tsx` |
| `announcement_created` | Admin publishes a new announcement | `app/(app)/(drawer)/[orgSlug]/announcements/new.tsx` |
| `calendar_event_tapped` | User taps an item in the unified calendar feed | `src/components/calendar/calendar-item-card.tsx` |

## Next steps

We've built some insights and a dashboard for you to keep an eye on user behavior, based on the events we just instrumented:

- **Dashboard — Analytics basics**: https://us.posthog.com/project/374297/dashboard/1444839
- **Auth: Signups & Logins Over Time**: https://us.posthog.com/project/374297/insights/mEQeGUcH
- **Auth Funnel: Signup → First Login**: https://us.posthog.com/project/374297/insights/4OUEEn5a
- **Engagement: Donations, Announcements & Check-ins**: https://us.posthog.com/project/374297/insights/CT0zIqdL
- **Donation Checkout: Unique Donors Per Week**: https://us.posthog.com/project/374297/insights/5u4e6b79
- **Calendar & Event Engagement Funnel**: https://us.posthog.com/project/374297/insights/HCAUJjZs

### Agent skill

We've left an agent skill folder in your project. You can use this context for further agent development when using Claude Code. This will help ensure the model provides the most up-to-date approaches for integrating PostHog.

</wizard-report>
