import { redirect } from "next/navigation";
import { calendarEventsPath } from "@/lib/calendar/routes";

interface EventsPageRedirectProps {
  params: Promise<{ orgSlug: string }>;
  searchParams: Promise<{ type?: string; view?: string }>;
}

export default async function EventsPageRedirect({ params, searchParams }: EventsPageRedirectProps) {
  const { orgSlug } = await params;
  const filters = await searchParams;

  redirect(calendarEventsPath(orgSlug, {
    timeframe: filters.view === "past" ? "past" : "upcoming",
    type: filters.type,
  }));
}
