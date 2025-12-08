import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Card, Badge, Button, EmptyState } from "@/components/ui";
import { PageHeader } from "@/components/layout";
import { isOrgAdmin } from "@/lib/auth";

interface EventsPageProps {
  params: Promise<{ orgSlug: string }>;
  searchParams: Promise<{ type?: string; view?: string }>;
}

export default async function EventsPage({ params, searchParams }: EventsPageProps) {
  const { orgSlug } = await params;
  const filters = await searchParams;
  const supabase = await createClient();

  // Fetch organization
  const { data: org } = await supabase
    .from("organizations")
    .select("*")
    .eq("slug", orgSlug)
    .single();

  if (!org) return null;

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

  return (
    <div className="animate-fade-in">
      <PageHeader
        title="Events"
        description={`${events?.length || 0} ${filters.view === "past" ? "past" : "upcoming"} events`}
        actions={
          isAdmin && (
            <Link href={`/${orgSlug}/events/new`}>
              <Button>
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                </svg>
                Add Event
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
            title={filters.view === "past" ? "No past events" : "No upcoming events"}
            description="Events will appear here once created"
            action={
              isAdmin && (
                <Link href={`/${orgSlug}/events/new`}>
                  <Button>Create First Event</Button>
                </Link>
              )
            }
          />
        </Card>
      )}
    </div>
  );
}

