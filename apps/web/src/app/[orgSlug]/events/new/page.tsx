import { redirect } from "next/navigation";
import { calendarNewEventPath } from "@/lib/calendar/routes";

interface LegacyNewEventPageProps {
  params: Promise<{ orgSlug: string }>;
}

export default async function LegacyNewEventPage({ params }: LegacyNewEventPageProps) {
  const { orgSlug } = await params;
  redirect(calendarNewEventPath(orgSlug));
}
