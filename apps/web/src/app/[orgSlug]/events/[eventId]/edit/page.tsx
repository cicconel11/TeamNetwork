import { redirect } from "next/navigation";
import { calendarEventEditPath } from "@/lib/calendar/routes";

interface LegacyEditEventPageProps {
  params: Promise<{ orgSlug: string; eventId: string }>;
}

export default async function LegacyEditEventPage({ params }: LegacyEditEventPageProps) {
  const { orgSlug, eventId } = await params;
  redirect(calendarEventEditPath(orgSlug, eventId));
}
