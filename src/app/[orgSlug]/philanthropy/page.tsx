import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Card, Badge, Button, EmptyState } from "@/components/ui";
import { PageHeader } from "@/components/layout";
import { EmbedManager, EmbedViewer } from "@/components/philanthropy";
import { isOrgAdmin } from "@/lib/auth";
import type { PhilanthropyEmbed } from "@/types/database";

interface PhilanthropyPageProps {
  params: Promise<{ orgSlug: string }>;
  searchParams: Promise<{ view?: string }>;
}

export default async function PhilanthropyPage({ params, searchParams }: PhilanthropyPageProps) {
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

  // Fetch philanthropy embeds (with graceful error handling for missing table)
  let embeds: PhilanthropyEmbed[] = [];
  let embedsError: string | null = null;
  
  const { data: embedsData, error: embedsFetchError } = await supabase
    .from("org_philanthropy_embeds")
    .select("*")
    .eq("organization_id", org.id)
    .order("display_order", { ascending: true });

  if (embedsFetchError) {
    // Check if this is a "table not found" error
    if (embedsFetchError.message.includes("schema cache") || embedsFetchError.code === "42P01") {
      embedsError = "Philanthropy embeds table not found. Please run database migrations.";
    } else {
      embedsError = embedsFetchError.message;
    }
  } else {
    embeds = (embedsData || []) as PhilanthropyEmbed[];
  }

  // Fetch philanthropy events (events where is_philanthropy = true or event_type = philanthropy)
  let query = supabase
    .from("events")
    .select("*")
    .eq("organization_id", org.id)
    .or("is_philanthropy.eq.true,event_type.eq.philanthropy");

  if (filters.view === "past") {
    query = query.lt("start_date", new Date().toISOString()).order("start_date", { ascending: false });
  } else {
    query = query.gte("start_date", new Date().toISOString()).order("start_date");
  }

  const { data: events } = await query;

  // Calculate stats
  const { data: allPhilanthropyEvents } = await supabase
    .from("events")
    .select("*")
    .eq("organization_id", org.id)
    .or("is_philanthropy.eq.true,event_type.eq.philanthropy");

  const totalEvents = allPhilanthropyEvents?.length || 0;
  const upcomingCount = allPhilanthropyEvents?.filter(e => new Date(e.start_date) >= new Date()).length || 0;
  const pastCount = totalEvents - upcomingCount;

  return (
    <div className="animate-fade-in">
      <PageHeader
        title="Philanthropy"
        description="Community service and volunteer events"
        actions={
          isAdmin && (
            <Link href={`/${orgSlug}/philanthropy/new`}>
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

      {/* Dev mode error banner for missing table */}
      {embedsError && process.env.NODE_ENV === "development" && (
        <Card className="p-4 mb-6 border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/20">
          <div className="flex items-start gap-3">
            <svg className="h-5 w-5 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
            </svg>
            <div>
              <p className="font-medium text-amber-800 dark:text-amber-200">Database Migration Required</p>
              <p className="text-sm text-amber-700 dark:text-amber-300 mt-1">{embedsError}</p>
              <p className="text-xs text-amber-600 dark:text-amber-400 mt-2">
                Run: <code className="bg-amber-100 dark:bg-amber-800 px-1 py-0.5 rounded">npx supabase db push</code> or apply the migration manually.
              </p>
            </div>
          </div>
        </Card>
      )}

      {/* Admin Embed Manager */}
      {isAdmin && !embedsError && <EmbedManager orgId={org.id} embeds={embeds} />}

      {/* Public Embed Viewer */}
      {!isAdmin && !embedsError && <EmbedViewer embeds={embeds} />}

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
        <Card className="p-5">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center">
              <svg className="h-5 w-5 text-emerald-600 dark:text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 8.25c0-2.485-2.099-4.5-4.688-4.5-1.935 0-3.597 1.126-4.312 2.733-.715-1.607-2.377-2.733-4.313-2.733C5.1 3.75 3 5.765 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12z" />
              </svg>
            </div>
            <div>
              <p className="text-2xl font-bold text-foreground font-mono">{totalEvents}</p>
              <p className="text-sm text-muted-foreground">Total Events</p>
            </div>
          </div>
        </Card>
        <Card className="p-5">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center">
              <svg className="h-5 w-5 text-blue-600 dark:text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5" />
              </svg>
            </div>
            <div>
              <p className="text-2xl font-bold text-foreground font-mono">{upcomingCount}</p>
              <p className="text-sm text-muted-foreground">Upcoming</p>
            </div>
          </div>
        </Card>
        <Card className="p-5">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-purple-100 dark:bg-purple-900/30 flex items-center justify-center">
              <svg className="h-5 w-5 text-purple-600 dark:text-purple-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <div>
              <p className="text-2xl font-bold text-foreground font-mono">{pastCount}</p>
              <p className="text-sm text-muted-foreground">Completed</p>
            </div>
          </div>
        </Card>
      </div>

      {/* Filters */}
      <div className="flex gap-2 mb-6">
        <Link
          href={`/${orgSlug}/philanthropy`}
          className={`px-4 py-2 rounded-xl text-sm font-medium transition-colors ${
            !filters.view
              ? "bg-org-primary text-white"
              : "bg-muted text-muted-foreground hover:text-foreground"
          }`}
        >
          Upcoming
        </Link>
        <Link
          href={`/${orgSlug}/philanthropy?view=past`}
          className={`px-4 py-2 rounded-xl text-sm font-medium transition-colors ${
            filters.view === "past"
              ? "bg-org-primary text-white"
              : "bg-muted text-muted-foreground hover:text-foreground"
          }`}
        >
          Past
        </Link>
      </div>

      {/* Events List */}
      {events && events.length > 0 ? (
        <div className="space-y-4 stagger-children">
          {events.map((event) => (
            <Link key={event.id} href={`/${orgSlug}/events/${event.id}`}>
              <Card interactive className="p-5">
                <div className="flex items-start gap-4">
                  {/* Date Block */}
                  <div className="h-16 w-16 rounded-xl bg-emerald-100 dark:bg-emerald-900/30 flex flex-col items-center justify-center text-center flex-shrink-0">
                    <span className="text-xs font-medium text-emerald-700 dark:text-emerald-300 uppercase">
                      {new Date(event.start_date).toLocaleDateString("en-US", { month: "short" })}
                    </span>
                    <span className="text-2xl font-bold text-emerald-700 dark:text-emerald-300 leading-none">
                      {new Date(event.start_date).getDate()}
                    </span>
                  </div>

                  {/* Event Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <h3 className="font-semibold text-foreground">{event.title}</h3>
                      <Badge variant="success">Philanthropy</Badge>
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
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 8.25c0-2.485-2.099-4.5-4.688-4.5-1.935 0-3.597 1.126-4.312 2.733-.715-1.607-2.377-2.733-4.313-2.733C5.1 3.75 3 5.765 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12z" />
              </svg>
            }
            title={filters.view === "past" ? "No past philanthropy events" : "No upcoming philanthropy events"}
            description="Philanthropy and volunteer events will appear here"
            action={
              isAdmin && (
                <Link href={`/${orgSlug}/philanthropy/new`}>
                  <Button>Create Philanthropy Event</Button>
                </Link>
              )
            }
          />
        </Card>
      )}
    </div>
  );
}
