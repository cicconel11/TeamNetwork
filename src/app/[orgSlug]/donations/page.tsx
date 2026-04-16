import { createClient } from "@/lib/supabase/server";
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
import { ExportCsvButton } from "@/components/shared";
import type { NavConfig } from "@/lib/navigation/nav-items";
import type { OrganizationDonationStat, OrganizationDonation } from "@/types/database";

const SETTLED_STATUSES = ["succeeded", "recorded"];

interface DonationsPageProps {
  params: Promise<{ orgSlug: string }>;
}

export default async function DonationsPage({ params }: DonationsPageProps) {
  const { orgSlug } = await params;
  const orgCtx = await getOrgContext(orgSlug);
  if (!orgCtx.organization) return null;
  const org = orgCtx.organization;

  const canEdit = canEditNavItem(org.nav_config as NavConfig, "/donations", orgCtx.role, ["admin"]);
  const supabase = await createClient();

  const [{ data: donationStats }, { data: donations }, { data: philanthropyEvents }, connectStatus] = await Promise.all([
    supabase
      .from("organization_donation_stats")
      .select("*")
      .eq("organization_id", org.id)
      .maybeSingle(),
    supabase
      .from("organization_donations")
      .select("*")
      .eq("organization_id", org.id)
      .is("deleted_at", null)
      .order("created_at", { ascending: false }),
    supabase
      .from("events")
      .select("id, title")
      .eq("organization_id", org.id)
      .is("deleted_at", null)
      .or("is_philanthropy.eq.true,event_type.eq.philanthropy")
      .order("start_date"),
    org.stripe_connect_account_id
      ? getConnectAccountStatus(org.stripe_connect_account_id)
      : Promise.resolve(null),
  ]);

  const stats = (donationStats || null) as OrganizationDonationStat | null;
  const allDonationRows = (donations || []) as OrganizationDonation[];
  const eventsForForm = (philanthropyEvents || []) as { id: string; title: string }[];

  // Server-side privacy gate: non-admins/non-editors only see public donations, no donor emails
  // When hide_donor_names is enabled, non-admins/editors see no donation rows at all
  const hideDonorNames = Boolean((org as Record<string, unknown>).hide_donor_names);
  const donationRows = (orgCtx.isAdmin || canEdit)
    ? allDonationRows
    : hideDonorNames
      ? []
      : allDonationRows
          .filter((d) => (d.visibility || "public") === "public" && SETTLED_STATUSES.includes(d.status))
          .map((d) => ({ ...d, donor_email: null }));

  const isConnected = Boolean(connectStatus?.isReady);
  const totalAmount = orgCtx.isAdmin
    ? (stats?.total_amount_cents ?? 0) / 100
    : donationRows.reduce((sum, d) => sum + (d.amount_cents || 0), 0) / 100;
  const donationCount = orgCtx.isAdmin
    ? (stats?.donation_count ?? allDonationRows.length)
    : donationRows.length;
  const avgDonation = donationCount > 0 ? totalAmount / donationCount : 0;

  const navConfig = org.nav_config as NavConfig | null;
  const [tNav, locale, tDonations] = await Promise.all([
    getTranslations("nav.items"),
    getLocale(),
    getTranslations("donations"),
  ]);
  const t = (key: string) => tNav(key);
  const pageLabel = resolveLabel("/donations", navConfig, t, locale);
  const exportStamp = new Date().toISOString().slice(0, 10);
  const purposeTotals = buildDonationPurposeTotals(donationRows, tDonations("generalSupport"));

  return (
    <div className="animate-fade-in">
      <DonationResultTracker organizationId={org.id} />
      <PageHeader
        title={pageLabel}
        description={`${donationCount} ${tDonations("contributions").toLowerCase()} totaling $${totalAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
        actions={
          orgCtx.isAdmin ? (
            <ExportCsvButton
              endpoint={`/api/organizations/${org.id}/exports/donations`}
              fileName={`${org.slug}-donations-${exportStamp}.csv`}
            />
          ) : undefined
        }
      />

      {canEdit && !isConnected && (
        <div className="mb-6">
          <ConnectSetup organizationId={org.id} isConnected={isConnected} connectStatus={connectStatus} />
        </div>
      )}

      {/* Stat strip — large numbers, no colored boxes */}
      <div className="mb-8">
        <div className="grid grid-cols-3 gap-8 mb-3">
          <div>
            <p className="text-xs uppercase tracking-wider text-muted-foreground mb-1">
              {tDonations("totalRaised")}
            </p>
            <p className="text-4xl font-bold font-mono tabular-nums text-foreground">
              ${totalAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wider text-muted-foreground mb-1">
              {tDonations("contributions")}
            </p>
            <p className="text-4xl font-bold font-mono tabular-nums text-foreground">
              {donationCount}
            </p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wider text-muted-foreground mb-1">
              {tDonations("averageGift")}
            </p>
            <p className="text-4xl font-bold font-mono tabular-nums text-foreground">
              ${avgDonation.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </p>
          </div>
        </div>
      </div>

      {/* Dashboard — admin controls, table, purpose breakdown, drawer */}
      <PhilanthropyDashboardClient
        organizationId={org.id}
        organizationSlug={org.slug}
        isAdmin={orgCtx.isAdmin}
        isStripeConnected={isConnected}
        donations={donationRows}
        purposeTotals={purposeTotals}
        philanthropyEventsForForm={eventsForForm}
        purposeEmptyMessage={tDonations("willGroupHere", { label: pageLabel })}
        hideDonorNames={hideDonorNames}
      />
    </div>
  );
}
