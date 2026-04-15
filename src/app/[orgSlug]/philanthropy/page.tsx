import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Card, Badge, Button, EmptyState } from "@/components/ui";
import { PageHeader } from "@/components/layout";
import { ConnectSetup } from "@/components/donations";
import { DonationResultTracker } from "@/components/analytics/DonationResultTracker";
import { PhilanthropyDashboardClient } from "@/components/philanthropy/PhilanthropyDashboardClient";
import { getOrgContext } from "@/lib/auth/roles";
import { canEditNavItem } from "@/lib/navigation/permissions";
import { getConnectAccountStatus } from "@/lib/stripe";
import { resolveLabel } from "@/lib/navigation/label-resolver";
import { buildDonationPurposeTotals } from "@/lib/payments/donation-purpose-totals";
import { getLocale, getTranslations } from "next-intl/server";
import { PhilanthropyFilter } from "@/components/philanthropy/PhilanthropyFilter";
import { ExportCsvButton } from "@/components/shared";
import type { NavConfig } from "@/lib/navigation/nav-items";
import type { OrganizationDonationStat, OrganizationDonation } from "@/types/database";

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
    .is("deleted_at", null)
    .or("is_philanthropy.eq.true,event_type.eq.philanthropy");

  if (filters.view === "past") {
    eventsQuery = eventsQuery.lt("start_date", new Date().toISOString()).order("start_date", { ascending: false });
  } else {
    eventsQuery = eventsQuery.gte("start_date", new Date().toISOString()).order("start_date");
  }

  const [{ data: events }, { data: donationStats }, { data: allPhilanthropyEvents }, { data: donations }, connectStatus] = await Promise.all([
    eventsQuery,
    supabase
      .from("organization_donation_stats")
      .select("*")
      .eq("organization_id", org.id)
      .maybeSingle(),
    supabase
      .from("events")
      .select("id, title, start_date")
      .eq("organization_id", org.id)
      .is("deleted_at", null)
      .or("is_philanthropy.eq.true,event_type.eq.philanthropy")
      .order("start_date"),
    supabase
      .from("organization_donations")
      .select("*")
      .eq("organization_id", org.id)
      .is("deleted_at", null)
      .order("created_at", { ascending: false }),
    org.stripe_connect_account_id
      ? getConnectAccountStatus(org.stripe_connect_account_id)
      : Promise.resolve(null),
  ]);

  const donationStat = (donationStats || null) as OrganizationDonationStat | null;
  const donationRows = (donations || []) as OrganizationDonation[];
  const totalRaised = (donationStat?.total_amount_cents ?? 0) / 100;
  const donationCount = donationStat?.donation_count ?? donationRows.length;
  const avgDonation = donationCount > 0 ? totalRaised / donationCount : 0;

  const totalEvents = allPhilanthropyEvents?.length || 0;
  const upcomingCount = allPhilanthropyEvents?.filter((e) => new Date(e.start_date) >= new Date()).length || 0;
  const pastCount = totalEvents - upcomingCount;
  const eventsForForm = (allPhilanthropyEvents || []).map((evt) => ({ id: evt.id, title: evt.title }));
  const isConnected = Boolean(connectStatus?.isReady);
  const purposeTotals = buildDonationPurposeTotals(donationRows, "General support");

  const navConfig = org.nav_config as NavConfig | null;
  const [tNav, locale, tPhilanthropy, , tEvents, tDonations] = await Promise.all([
    getTranslations("nav.items"),
    getLocale(),
    getTranslations("philanthropy"),
    getTranslations("common"),
    getTranslations("events"),
    getTranslations("donations"),
  ]);
  const t = (key: string) => tNav(key);
  const pageLabel = resolveLabel("/philanthropy", navConfig, t, locale);
  const exportStamp = new Date().toISOString().slice(0, 10);

  return (
    <div className="animate-fade-in">
      <DonationResultTracker organizationId={org.id} />
      <PageHeader
        title={pageLabel}
        description={tPhilanthropy("description")}
        actions={
          (orgCtx.isAdmin || canEdit) ? (
            <div className="flex flex-wrap gap-2">
              {orgCtx.isAdmin && (
                <ExportCsvButton
                  endpoint={`/api/organizations/${org.id}/exports/philanthropy`}
                  fileName={`${org.slug}-philanthropy-${exportStamp}.csv`}
                />
              )}
              {orgCtx.isAdmin && (
                <ExportCsvButton
                  endpoint={`/api/organizations/${org.id}/exports/donations`}
                  fileName={`${org.slug}-donations-${exportStamp}.csv`}
                />
              )}
              {canEdit && (
                <Link href={`/${orgSlug}/philanthropy/new`}>
                  <Button>
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                    </svg>
                    {tPhilanthropy("addEvent")}
                  </Button>
                </Link>
              )}
            </div>
          ) : undefined
        }
      />

      {/* Stripe Connect onboarding banners */}
      {onboardingStatus === "success" && isConnected && (
        <div className="mb-6 rounded-lg border border-emerald-200 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950/30 p-4">
          <p className="text-sm font-medium text-emerald-800 dark:text-emerald-200">
            {tPhilanthropy("stripeConnectedSuccess")}
          </p>
        </div>
      )}
      {onboardingStatus === "success" && !isConnected && (
        <div className="mb-6 rounded-lg border border-blue-200 bg-blue-50 dark:border-blue-800 dark:bg-blue-950/30 p-4">
          <p className="text-sm font-medium text-blue-800 dark:text-blue-200">
            {tPhilanthropy("stripeSubmitted")}
          </p>
        </div>
      )}
      {onboardingStatus === "refresh" && (
        <div className="mb-6 rounded-lg border border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/30 p-4">
          <p className="text-sm font-medium text-amber-800 dark:text-amber-200">
            {tPhilanthropy("stripeNotCompleted")}
          </p>
        </div>
      )}

      {orgCtx.isAdmin && !isConnected && (
        <div className="mb-6">
          <ConnectSetup organizationId={org.id} isConnected={isConnected} connectStatus={connectStatus} />
        </div>
      )}

      {/* Stat strip — large numbers, no colored boxes */}
      <div className="mb-8">
        <div className="grid grid-cols-2 gap-8 mb-3">
          <div>
            <p className="text-xs uppercase tracking-wider text-muted-foreground mb-1">
              {tPhilanthropy("totalRaisedLabel")}
            </p>
            <p className="text-4xl font-bold font-mono tabular-nums text-foreground">
              ${totalRaised.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wider text-muted-foreground mb-1">
              {tPhilanthropy("averageGiftLabel")}
            </p>
            <p className="text-4xl font-bold font-mono tabular-nums text-foreground">
              ${avgDonation.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </p>
          </div>
        </div>
        <p className="text-sm text-muted-foreground">
          {donationCount} {tPhilanthropy("contributionsRecorded")} · {totalEvents} {tPhilanthropy("totalEvents").toLowerCase()} · {upcomingCount} {tEvents("upcoming").toLowerCase()} · {pastCount} {tPhilanthropy("completed").toLowerCase()}
        </p>
      </div>

      {/* Dashboard client section — admin controls, table, purpose breakdown, drawer */}
      <PhilanthropyDashboardClient
        organizationId={org.id}
        organizationSlug={org.slug}
        isAdmin={orgCtx.isAdmin}
        isStripeConnected={isConnected}
        donations={donationRows}
        purposeTotals={purposeTotals}
        philanthropyEventsForForm={eventsForForm}
        purposeEmptyMessage={tDonations("willGroupHere", { label: pageLabel })}
      />

      {/* Events section */}
      <div className="flex gap-2 mb-6 mt-8">
        <PhilanthropyFilter orgSlug={orgSlug} currentView={filters.view} />
      </div>

      {events && events.length > 0 ? (
        <div className="space-y-4 stagger-children">
          {events.map((event) => (
            <Link key={event.id} href={`/${orgSlug}/calendar/events/${event.id}`}>
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
          title={filters.view === "past" ? tPhilanthropy("noPastEvents", { label: pageLabel.toLowerCase() }) : tPhilanthropy("noUpcomingEvents", { label: pageLabel.toLowerCase() })}
          description={filters.view === "past" ? tPhilanthropy("completedWillAppear") : tPhilanthropy("addNewEvent")}
          action={
            canEdit ? (
              <Link href={`/${orgSlug}/philanthropy/new`}>
                <Button>{tPhilanthropy("addEvent")}</Button>
              </Link>
            ) : undefined
          }
        />
      )}
    </div>
  );
}
