import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/layout";
import { Button } from "@/components/ui";
import { getOrgContext } from "@/lib/auth/roles";
import { CalendarViewToggle } from "@/components/calendar/CalendarViewToggle";
import { CalendarTab } from "@/components/calendar/CalendarTab";
import { AvailabilityTab } from "@/components/schedules/tabs/AvailabilityTab";
import { resolveLabel } from "@/lib/navigation/label-resolver";
import { getLocale, getTranslations } from "next-intl/server";
import { buildUnifiedCalendarDateRange, fetchUnifiedEvents } from "@/lib/calendar/unified-events";
import { calendarMySettingsPath, calendarNewEventPath, calendarNewSchedulePath, calendarSourcesPath, calendarListPath } from "@/lib/calendar/routes";
import { parseCalendarView } from "@/lib/calendar/view-state";
import { resolveEventActionLabel } from "@/lib/events/labels";
import type { NavConfig } from "@/lib/navigation/nav-items";
import { resolveOrgTimezone } from "@/lib/utils/timezone";
import type { AcademicSchedule, User } from "@/types/database";
import type { UnifiedEvent } from "@/lib/calendar/unified-events";

interface CalendarPageProps {
  params: Promise<{ orgSlug: string }>;
  searchParams: Promise<{ view?: string; subview?: string; timeframe?: string; type?: string }>;
}

export default async function CalendarPage({ params, searchParams }: CalendarPageProps) {
  const { orgSlug } = await params;
  const filters = await searchParams;

  // Redirect old view params to new structure
  if (filters.view === "events" || filters.view === "all") {
    redirect(calendarListPath(orgSlug));
  }

  const orgCtx = await getOrgContext(orgSlug);
  const supabase = await createClient();

  if (!orgCtx.organization || !orgCtx.userId) return null;

  const orgId = orgCtx.organization.id;
  const currentView = parseCalendarView(filters.view);
  const orgTimeZone = resolveOrgTimezone(orgCtx.organization.timezone);

  const { start: rangeStart, end: rangeEnd } = buildUnifiedCalendarDateRange();

  const [mySchedulesResult, allSchedulesResult, initialEventsResult] = await Promise.all([
    supabase
      .from("academic_schedules")
      .select("*")
      .eq("organization_id", orgId)
      .eq("user_id", orgCtx.userId)
      .is("deleted_at", null)
      .order("start_time", { ascending: true }),
    orgCtx.isAdmin
      ? supabase
          .from("academic_schedules")
          .select("*, users(name, email)")
          .eq("organization_id", orgId)
          .is("deleted_at", null)
          .order("start_time", { ascending: true })
      : Promise.resolve({ data: [] }),
    fetchUnifiedEvents(supabase, orgId, orgCtx.userId, {
      start: rangeStart,
      end: rangeEnd,
      timeZone: orgTimeZone,
    }).catch((err) => {
      console.error("[calendar] Server-side event fetch failed, client will retry:", err);
      return undefined;
    }),
  ]);

  const mySchedules = mySchedulesResult.data || [];
  const allSchedules = (allSchedulesResult.data || []) as (AcademicSchedule & { users: Pick<User, "name" | "email"> | null })[];
  const initialEvents: UnifiedEvent[] | undefined = initialEventsResult ?? undefined;

  const navConfig = orgCtx.organization.nav_config as NavConfig | null;
  const [tNav, locale] = await Promise.all([getTranslations("nav.items"), getLocale()]);
  const t = (key: string) => tNav(key);
  const pageLabel = resolveLabel("/calendar", navConfig, t, locale);
  const tCalendar = await getTranslations("calendar");

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title={pageLabel}
        description={tCalendar("description")}
        actions={
          <div className="flex items-center gap-2">
            {orgCtx.isAdmin && (
              <Link href={calendarSourcesPath(orgSlug)}>
                <Button variant="secondary">
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.241-.438.613-.431.992a6.759 6.759 0 010 .255c-.007.378.138.75.43.99l1.005.828c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 010-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.28z" />
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                  <span className="sr-only">Manage Sources</span>
                  <span className="hidden sm:inline">{tCalendar("sources")}</span>
                </Button>
              </Link>
            )}
            <Link href={calendarMySettingsPath(orgSlug)}>
              <Button variant="secondary">
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182M2.985 19.644l3.181-3.182" />
                </svg>
                <span className="sr-only">Sync Settings</span>
                <span className="hidden sm:inline">{tCalendar("sync")}</span>
              </Button>
            </Link>
            <Link href={calendarNewSchedulePath(orgSlug)}>
              <Button variant="secondary">Add Schedule</Button>
            </Link>
            {orgCtx.isAdmin && (
              <Link href={calendarNewEventPath(orgSlug)} data-testid="event-new-link">
                <Button>
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                  </svg>
                  {resolveEventActionLabel(navConfig, "Add", t, locale)}
                </Button>
              </Link>
            )}
          </div>
        }
      />

      <div className="space-y-6">
        <CalendarViewToggle />

        <div className="animate-fade-in">
          {currentView === "availability" ? (
            <AvailabilityTab
              orgId={orgId}
              orgSlug={orgSlug}
              isAdmin={orgCtx.isAdmin}
              mySchedules={mySchedules}
              allSchedules={allSchedules}
              timeZone={orgTimeZone}
            />
          ) : (
            <CalendarTab
              orgId={orgId}
              orgSlug={orgSlug}
              initialEvents={initialEvents}
              timeZone={orgTimeZone}
            />
          )}
        </div>
      </div>
    </div>
  );
}
