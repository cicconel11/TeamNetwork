import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Card, Badge, Button, EmptyState } from "@/components/ui";
import { PageHeader } from "@/components/layout";
import { DonationForm, ConnectSetup } from "@/components/donations";
import { getOrgContext } from "@/lib/auth/roles";
import { canEditNavItem } from "@/lib/navigation/permissions";
import { getConnectAccountStatus } from "@/lib/stripe";
import { resolveLabel } from "@/lib/navigation/label-resolver";
import type { NavConfig } from "@/lib/navigation/nav-items";
import type { OrganizationDonationStat } from "@/types/database";
import { PhilanthropyFilter } from "@/components/philanthropy/PhilanthropyFilter";
import { ExportCsvButton } from "@/components/shared";

interface PhilanthropyPageProps {
  params: Promise<{ orgSlug: string }>;
  searchParams: Promise<{ view?: string; onboarding?: string }>;
}

export default async function PhilanthropyPage({ params, searchParams }: PhilanthropyPageProps) {
  const { orgSlug } = await params;
  const filters = await searchParams;
  const onboardingStatus = filters.onboarding;
  const orgCtx = await getOrgContext(orgSlug);
  if (!orgCtx.organization) return null;
  const org = orgCtx.organization;
  const canEdit = canEditNavItem(org.nav_config as NavConfig, "/philanthropy", orgCtx.role, ["admin", "active_member"]);
  const supabase = await createClient();

  let eventsQuery = supabase
    .from("events")
    .select("*")
    .eq("organization_id", org.id)
    .or("is_philanthropy.eq.true,event_type.eq.philanthropy");

  if (filters.view === "past") {
    eventsQuery = eventsQuery.lt("start_date", new Date().toISOString()).order("start_date", { ascending: false });
  } else {
    eventsQuery = eventsQuery.gte("start_date", new Date().toISOString()).order("start_date");
  }

  const [{ data: events }, { data: donationStats }, { data: allPhilanthropyEvents }] = await Promise.all([
    eventsQuery,
    supabase
      .from("organization_donation_stats")
      .select("*")
      .eq("organization_id", org.id)
      .maybeSingle(),
    supabase
      .from("events")
      .select("*")
      .eq("organization_id", org.id)
      .or("is_philanthropy.eq.true,event_type.eq.philanthropy"),
  ]);

  const donationStat = (donationStats || null) as OrganizationDonationStat | null;
  const totalRaised = (donationStat?.total_amount_cents ?? 0) / 100;
  const donationCount = donationStat?.donation_count ?? 0;

  const totalEvents = allPhilanthropyEvents?.length || 0;
  const upcomingCount = allPhilanthropyEvents?.filter((e) => new Date(e.start_date) >= new Date()).length || 0;
  const pastCount = totalEvents - upcomingCount;
  const eventsForForm = (allPhilanthropyEvents || []).map((evt) => ({ id: evt.id, title: evt.title }));
  const connectStatus = org.stripe_connect_account_id
    ? await getConnectAccountStatus(org.stripe_connect_account_id)
    : null;
  const isConnected = Boolean(connectStatus?.isReady);

  const navConfig = org.nav_config as NavConfig | null;
  const pageLabel = resolveLabel("/philanthropy", navConfig);
  const exportStamp = new Date().toISOString().slice(0, 10);

  return (
    <div className="animate-fade-in">
      <PageHeader
        title={pageLabel}
        description="Community service and fundraising for your organization."
        actions={
          (orgCtx.isAdmin || canEdit) ? (
            <div className="flex flex-wrap gap-2">
              {orgCtx.isAdmin && (
                <ExportCsvButton
                  endpoint={`/api/organizations/${org.id}/exports/philanthropy`}
                  fileName={`${org.slug}-philanthropy-${exportStamp}.csv`}
                />
              )}
              {canEdit && (
                <Link href={`/${orgSlug}/philanthropy/new`}>
                  <Button>
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                    </svg>
                    Add Event
                  </Button>
                </Link>
              )}
            </div>
          ) : undefined
        }
      />

      {onboardingStatus === "success" && isConnected && (
        <div className="mb-6 rounded-lg border border-emerald-200 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950/30 p-4">
          <p className="text-sm font-medium text-emerald-800 dark:text-emerald-200">
            Stripe account connected successfully! You can now accept donations.
          </p>
        </div>
      )}
      {onboardingStatus === "success" && !isConnected && (
        <div className="mb-6 rounded-lg border border-blue-200 bg-blue-50 dark:border-blue-800 dark:bg-blue-950/30 p-4">
          <p className="text-sm font-medium text-blue-800 dark:text-blue-200">
            Stripe account setup submitted. Verification is in progress — this usually takes 1-2 business days.
          </p>
        </div>
      )}
      {onboardingStatus === "refresh" && (
        <div className="mb-6 rounded-lg border border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/30 p-4">
          <p className="text-sm font-medium text-amber-800 dark:text-amber-200">
            Stripe setup was not completed. Please try again when you&apos;re ready.
          </p>
        </div>
      )}

      {orgCtx.isAdmin && !isConnected && (
        <div className="mb-6">
          <ConnectSetup organizationId={org.id} isConnected={isConnected} connectStatus={connectStatus} />
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
        <div className="lg:col-span-2">
          <DonationForm
            organizationId={org.id}
            organizationSlug={org.slug}
            philanthropyEventsForForm={eventsForForm}
            isStripeConnected={isConnected}
          />
        </div>
        <Card className="p-6 space-y-3">
          <div>
            <p className="text-sm text-muted-foreground">Stripe Donations</p>
            <p className="text-3xl font-bold text-foreground font-mono">
              ${totalRaised.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </p>
            <p className="text-sm text-muted-foreground">{donationCount} contributions recorded</p>
          </div>
          <div className={`inline-flex px-3 py-1 rounded-full text-xs font-semibold ${isConnected ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}>
            {isConnected ? "Connected" : "Connect Stripe to accept donations"}
          </div>
        </Card>
      </div>

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

      <div className="flex gap-2 mb-6">
        <PhilanthropyFilter orgSlug={orgSlug} currentView={filters.view} />
      </div>

      {events && events.length > 0 ? (
        <div className="space-y-4 stagger-children">
          {events.map((event) => (
            <Link key={event.id} href={`/${orgSlug}/events/${event.id}`}>
              <Card interactive className="p-5">
                <div className="flex items-start gap-4">
                  <div className="h-16 w-16 rounded-xl bg-emerald-100 dark:bg-emerald-900/30 flex flex-col items-center justify-center text-center flex-shrink-0">
                    <span className="text-xs font-medium text-emerald-700 dark:text-emerald-300 uppercase">
                      {new Date(event.start_date).toLocaleDateString("en-US", { month: "short" })}
                    </span>
                    <span className="text-2xl font-bold text-emerald-700 dark:text-emerald-300 leading-none">
                      {new Date(event.start_date).getDate()}
                    </span>
                  </div>

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
                          minute: "2-digit",
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
        <EmptyState
          title={filters.view === "past" ? `No past ${pageLabel.toLowerCase()} events` : `No upcoming ${pageLabel.toLowerCase()} events`}
          description={filters.view === "past" ? "Completed events will appear here." : "Add a new philanthropy event to get started."}
          action={
            canEdit ? (
              <Link href={`/${orgSlug}/philanthropy/new`}>
                <Button>Add Event</Button>
              </Link>
            ) : undefined
          }
        />
      )}
    </div>
  );
}
