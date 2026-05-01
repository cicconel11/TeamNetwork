/** Same deep-link as mobile QR for member self check-in (`teammeet://event-checkin/...`). */
export function buildEventSelfCheckInDeepLink(eventId: string, orgSlug: string): string {
  const e = encodeURIComponent(eventId);
  const o = encodeURIComponent(orgSlug);
  return `teammeet://event-checkin/${e}?org=${o}`;
}
