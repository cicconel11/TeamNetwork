import { redirect } from "next/navigation";
import { calendarEventDetailPath } from "@/lib/calendar/routes";

interface LegacyEventDetailPageProps {
  params: Promise<{ orgSlug: string; eventId: string }>;
}

export default async function LegacyEventDetailPage({ params }: LegacyEventDetailPageProps) {
  const { orgSlug, eventId } = await params;
  redirect(calendarEventDetailPath(orgSlug, eventId));
}
