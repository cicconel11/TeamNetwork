import { notFound } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Card, Badge, Button } from "@/components/ui";
import { PageHeader } from "@/components/layout";
import { isOrgAdmin } from "@/lib/auth";
import { EventRsvp, AttendanceList, EventDeleteButton } from "@/components/events";
import type { RsvpStatus } from "@teammeet/types";

interface EventDetailPageProps {
  params: Promise<{ orgSlug: string; eventId: string }>;
}

export default async function EventDetailPage({ params }: EventDetailPageProps) {
  const { orgSlug, eventId } = await params;
  const supabase = await createClient();

  // Fetch organization
  const { data: orgs, error: orgError } = await supabase
    .from("organizations")
    .select("*")
    .eq("slug", orgSlug)
    .limit(1);

  const org = orgs?.[0];

  if (!org || orgError) return notFound();

  // Fetch event
  const { data: event } = await supabase
    .from("events")
    .select("*")
    .eq("id", eventId)
    .eq("organization_id", org.id)
    .is("deleted_at", null)
    .single();

  if (!event) return notFound();

  const isAdmin = await isOrgAdmin(org.id);
  const isPast = new Date(event.start_date) < new Date();

  // Get current user
  const { data: { user } } = await supabase.auth.getUser();

  // Fetch current user's RSVP
  let userRsvpStatus: RsvpStatus | null = null;
  if (user) {
    const { data: userRsvp } = await supabase
      .from("event_rsvps")
      .select("status")
      .eq("event_id", eventId)
      .eq("user_id", user.id)
      .maybeSingle();
    userRsvpStatus = (userRsvp?.status as RsvpStatus) ?? null;
  }

  // Fetch all RSVPs with user names
  const { data: rsvps } = await supabase
    .from("event_rsvps")
    .select("user_id, status, users(name, email)")
    .eq("event_id", eventId);

  const attendees = (rsvps ?? []).map((r) => {
    const userData = Array.isArray(r.users) ? r.users[0] : r.users;
    return {
      userId: r.user_id,
      userName: userData?.name || userData?.email || "Unknown",
      status: r.status as RsvpStatus,
    };
  });

  return (
    <div className="animate-fade-in">
      <PageHeader
        title={event.title}
        backHref={`/${orgSlug}/events`}
        actions={
          isAdmin && (
            <div className="flex items-center gap-2">
              <Link href={`/${orgSlug}/events/${eventId}/edit`}>
                <Button variant="secondary">
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10" />
                  </svg>
                  Edit
                </Button>
              </Link>
              <EventDeleteButton
                eventId={eventId}
                organizationId={org.id}
                redirectTo={`/${orgSlug}/events`}
              />
            </div>
          )
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main Content */}
        <Card className="p-6 lg:col-span-2">
          <div className="flex flex-wrap gap-2 mb-4">
            <Badge variant={isPast ? "muted" : "success"}>
              {isPast ? "Past Event" : "Upcoming"}
            </Badge>
            <Badge variant="muted" className="capitalize">{event.event_type}</Badge>
            {event.is_philanthropy && (
              <Badge variant="primary">Philanthropy</Badge>
            )}
          </div>

          <h2 className="text-2xl font-bold text-foreground mb-4">{event.title}</h2>
          
          {event.description && (
            <div className="prose prose-sm text-muted-foreground max-w-none">
              <p className="whitespace-pre-wrap">{event.description}</p>
            </div>
          )}
        </Card>

        {/* Event Details Sidebar */}
        <Card className="p-6 lg:col-span-1 h-fit">
          <h3 className="font-semibold text-foreground mb-4">Event Details</h3>
          
          <dl className="space-y-4">
            <div>
              <dt className="text-sm text-muted-foreground flex items-center gap-2">
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5" />
                </svg>
                Date
              </dt>
              <dd className="text-foreground font-medium mt-1">
                {new Date(event.start_date).toLocaleDateString("en-US", {
                  weekday: "long",
                  year: "numeric",
                  month: "long",
                  day: "numeric",
                })}
              </dd>
            </div>

            <div>
              <dt className="text-sm text-muted-foreground flex items-center gap-2">
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                Time
              </dt>
              <dd className="text-foreground font-medium mt-1">
                {new Date(event.start_date).toLocaleTimeString("en-US", {
                  hour: "numeric",
                  minute: "2-digit",
                })}
                {event.end_date && (
                  <>
                    {" — "}
                    {new Date(event.end_date).toLocaleTimeString("en-US", {
                      hour: "numeric",
                      minute: "2-digit",
                    })}
                  </>
                )}
              </dd>
            </div>

            {event.location && (
              <div>
                <dt className="text-sm text-muted-foreground flex items-center gap-2">
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 10.5a3 3 0 11-6 0 3 3 0 016 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1115 0z" />
                  </svg>
                  Location
                </dt>
                <dd className="text-foreground font-medium mt-1">{event.location}</dd>
              </div>
            )}
          </dl>

          {/* RSVP Section */}
          {user && (
            <div className="pt-4 mt-4 border-t border-border">
              <EventRsvp
                eventId={eventId}
                organizationId={org.id}
                userId={user.id}
                initialStatus={userRsvpStatus}
              />
            </div>
          )}

          {/* Attendance List */}
          <div className="pt-4 mt-4 border-t border-border">
            <AttendanceList attendees={attendees} />
          </div>

          <div className="pt-4 mt-4 border-t border-border">
            <p className="text-sm text-muted-foreground">
              Created {new Date(event.created_at).toLocaleDateString()}
            </p>
          </div>
        </Card>
      </div>
    </div>
  );
}

