/** Deep-link URL encoded in event check-in QR (member self scan). */
export function buildEventSelfCheckInDeepLink(eventId: string, orgSlug: string): string {
  const e = encodeURIComponent(eventId);
  const o = encodeURIComponent(orgSlug);
  return `teammeet://event-checkin/${e}?org=${o}`;
}
