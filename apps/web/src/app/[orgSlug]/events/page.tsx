import { Suspense } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Card, Badge, Button, EmptyState } from "@/components/ui";
import { PageHeader } from "@/components/layout";
import { isOrgAdmin } from "@/lib/auth";
import { resolveLabel, resolveActionLabel } from "@/lib/navigation/label-resolver";
import type { NavConfig } from "@/lib/navigation/nav-items";
import { EventsViewTracker } from "@/components/analytics/EventsViewTracker";
import { GoogleCalendarBanner } from "@/components/events";

interface EventsPageProps {
  params: Promise<{ orgSlug: string }>;
  searchParams: Promise<{ type?: string; view?: string }>;
}

export default async function EventsPage({ params, searchParams }: EventsPageProps) {
  const { orgSlug } = await params;
  const filters = await searchParams;
  const supabase = await createClient();

  // Fetch organization
  const { data: orgs, error: orgError } = await supabase
    .from("organizations")
    .select("*")
    .eq("slug", orgSlug)
    .limit(1);

  const org = orgs?.[0];

  if (!org || orgError) return null;

  const isAdmin = await isOrgAdmin(org.id);

  // Build query with filters
  let query = supabase
    .from("events")
    .select("*")
    .eq("organization_id", org.id)
    .is("deleted_at", null);

  // Default: show upcoming events first
  if (filters.view === "past") {
    query = query.lt("start_date", new Date().toISOString()).order("start_date", { ascending: false });
  } else {
    query = query.gte("start_date", new Date().toISOString()).order("start_date");
  }

  if (filters.type) {
    query = query.eq("event_type", filters.type);
  }

  const { data: events } = await query;

  const eventTypes = ["general", "game", "meeting", "social", "fundraiser", "philanthropy"];

  const navConfig = org.nav_config as NavConfig | null;
  const pageLabel = resolveLabel("/events", navConfig);
  const actionLabel = resolveActionLabel("/events", navConfig);

  return (
    <div className="animate-fade-in">
      <EventsViewTracker
        organizationId={org.id}
        viewMode={filters.view === "past" ? "past" : "upcoming"}
      />
      <PageHeader
        title={pageLabel}
        description={`${events?.length || 0} ${filters.view === "past" ? "past" : "upcoming"} ${pageLabel.toLowerCase()}`}
        actions={
          isAdmin && (
            <Link href={`/${orgSlug}/events/new`}>
              <Button>
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                </svg>
                {actionLabel}
              </Button>
            </Link>
          )
        }
      />

      {/* Filters */}
      <div className="flex flex-wrap gap-2 mb-6">
        <Link
          href={`/${orgSlug}/events`}
          className={`px-4 py-2 rounded-xl text-sm font-medium transition-colors ${
            !filters.view || filters.view === "upcoming"
              ? "bg-org-primary text-white"
              : "bg-muted text-muted-foreground hover:text-foreground"
          }`}
        >
          Upcoming
        </Link>
        <Link
          href={`/${orgSlug}/events?view=past`}
          className={`px-4 py-2 rounded-xl text-sm font-medium transition-colors ${
            filters.view === "past"
              ? "bg-org-primary text-white"
              : "bg-muted text-muted-foreground hover:text-foreground"
          }`}
        >
          Past
        </Link>
        <div className="w-px bg-border mx-2" />
        {eventTypes.map((type) => (
          <Link
            key={type}
            href={`/${orgSlug}/events?type=${type}${filters.view ? `&view=${filters.view}` : ""}`}
            className={`px-4 py-2 rounded-xl text-sm font-medium transition-colors capitalize ${
              filters.type === type
                ? "bg-org-primary text-white"
                : "bg-muted text-muted-foreground hover:text-foreground"
            }`}
          >
            {type}
          </Link>
        ))}
      </div>

      <Suspense fallback={null}>
        <GoogleCalendarBanner
          orgId={org.id}
          orgSlug={orgSlug}
          orgName={org.name}
        />
      </Suspense>

      {/* Events List */}
      {events && events.length > 0 ? (
        <div className="space-y-4 stagger-children">
          {events.map((event) => (
            <Link key={event.id} href={`/${orgSlug}/events/${event.id}`}>
              <Card interactive className="p-5">
                <div className="flex items-start gap-4">
                  {/* Date Block */}
                  <div className="h-16 w-16 rounded-xl bg-muted flex flex-col items-center justify-center text-center flex-shrink-0">
                    <span className="text-xs font-medium text-muted-foreground uppercase">
                      {new Date(event.start_date).toLocaleDateString("en-US", { month: "short" })}
                    </span>
                    <span className="text-2xl font-bold text-foreground leading-none">
                      {new Date(event.start_date).getDate()}
                    </span>
                  </div>

                  {/* Event Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <h3 className="font-semibold text-foreground">{event.title}</h3>
                      <div className="flex gap-2 flex-shrink-0">
                        <Badge variant="muted" className="capitalize">{event.event_type}</Badge>
                        {event.is_philanthropy && (
                          <Badge variant="success">Philanthropy</Badge>
                        )}
                        {event.recurrence_group_id && (
                          <span className="text-muted-foreground" title="Recurring event">
                            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                            </svg>
                          </span>
                        )}
                      </div>
                    </div>
                    {event.description && (
                      <p className="text-sm text-muted-foreground mt-1 line-clamp-2">
                        {event.description}
                      </p>
                    )}
                    <div className="flex items-center gap-4 mt-3 text-sm text-muted-foreground">
                      <div className="flex items-center gap-1.5">
                        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        {new Date(event.start_date).toLocaleTimeString("en-US", { 
                          hour: "numeric", 
                          minute: "2-digit" 
                        })}
                      </div>
                      {event.location && (
                        <div className="flex items-center gap-1.5">
                          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M15 10.5a3 3 0 11-6 0 3 3 0 016 0z" />
                            <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1115 0z" />
                          </svg>
                          {event.location}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </Card>
            </Link>
          ))}
        </div>
      ) : (
        <Card>
          <EmptyState
            icon={
              <svg className="h-12 w-12" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5" />
              </svg>
            }
            title={filters.view === "past" ? `No past ${pageLabel.toLowerCase()}` : `No upcoming ${pageLabel.toLowerCase()}`}
            description={`${pageLabel} will appear here once created`}
            action={
              isAdmin && (
                <Link href={`/${orgSlug}/events/new`}>
                  <Button>{resolveActionLabel("/events", navConfig, "Create First")}</Button>
                </Link>
              )
            }
          />
        </Card>
      )}
    </div>
  );
}
