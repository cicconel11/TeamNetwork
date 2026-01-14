import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Card, Badge, EmptyState } from "@/components/ui";
import { PageHeader } from "@/components/layout";
import { DonationForm, ConnectSetup } from "@/components/donations";
import { getOrgContext } from "@/lib/auth/roles";
import { canEditNavItem } from "@/lib/navigation/permissions";
import { getConnectAccountStatus } from "@/lib/stripe";
import { resolveLabel } from "@/lib/navigation/label-resolver";
import type { NavConfig } from "@/lib/navigation/nav-items";
import type { OrganizationDonation, OrganizationDonationStat } from "@/types/database";

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

  const [{ data: donationStats }, { data: donations }, { data: philanthropyEvents }] = await Promise.all([
    supabase
      .from("organization_donation_stats")
      .select("*")
      .eq("organization_id", org.id)
      .maybeSingle(),
    supabase
      .from("organization_donations")
      .select("*")
      .eq("organization_id", org.id)
      .order("created_at", { ascending: false }),
    supabase
      .from("events")
      .select("id, title")
      .eq("organization_id", org.id)
      .or("is_philanthropy.eq.true,event_type.eq.philanthropy")
      .order("start_date"),
  ]);

  const connectStatus = org.stripe_connect_account_id
    ? await getConnectAccountStatus(org.stripe_connect_account_id)
    : null;

  const stats = (donationStats || null) as OrganizationDonationStat | null;
  const donationRows = (donations || []) as OrganizationDonation[];
  const eventsForForm = (philanthropyEvents || []) as { id: string; title: string }[];

  const isConnected = Boolean(connectStatus?.isReady);
  const totalAmount = (stats?.total_amount_cents ?? 0) / 100;
  const donationCount = stats?.donation_count ?? donationRows.length;
  const avgDonation = donationCount > 0 ? totalAmount / donationCount : 0;

  const purposeTotals = donationRows.reduce<Record<string, number>>((acc, donation) => {
    const label = donation.purpose || "General support";
    acc[label] = (acc[label] || 0) + (donation.amount_cents || 0);
    return acc;
  }, {});

  const navConfig = org.nav_config as NavConfig | null;
  const pageLabel = resolveLabel("/donations", navConfig);

  return (
    <div className="animate-fade-in">
      <PageHeader
        title={pageLabel}
        description={`${donationCount} contributions totaling ${totalAmount.toLocaleString(undefined, {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        })}`}
      />

      {canEdit && !isConnected && (
        <div className="mb-6">
          <ConnectSetup organizationId={org.id} isConnected={isConnected} />
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

        <div className="space-y-3">
          <Card className="p-5">
            <p className="text-sm text-muted-foreground mb-1">Total Raised</p>
            <p className="text-3xl font-bold text-foreground font-mono">
              ${totalAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </p>
          </Card>
          <Card className="p-5">
            <p className="text-sm text-muted-foreground mb-1">Contributions</p>
            <p className="text-3xl font-bold text-foreground font-mono">{donationCount}</p>
          </Card>
          <Card className="p-5">
            <p className="text-sm text-muted-foreground mb-1">Average Gift</p>
            <p className="text-3xl font-bold text-foreground font-mono">
              ${avgDonation.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </p>
          </Card>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="p-6 lg:col-span-1">
          <h3 className="font-semibold text-foreground mb-4">By Purpose</h3>
          <div className="space-y-3">
            {Object.entries(purposeTotals).length > 0 ? (
              Object.entries(purposeTotals)
                .sort(([, a], [, b]) => b - a)
                .map(([purpose, cents]) => (
                  <div key={purpose} className="flex items-center justify-between p-3 rounded-xl bg-muted/50">
                    <span className="text-foreground">{purpose}</span>
                    <span className="font-mono font-medium text-foreground">
                      ${(cents / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </span>
                  </div>
                ))
            ) : (
              <p className="text-sm text-muted-foreground">{pageLabel} will be grouped here once received.</p>
            )}
          </div>
        </Card>

        <Card className="p-0 lg:col-span-2 overflow-hidden">
          <div className="p-4 border-b border-border flex items-center justify-between">
            <h3 className="font-semibold text-foreground">Recent {pageLabel}</h3>
            {canEdit && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                {isConnected ? "Funds settle directly via Stripe Connect" : "Stripe not connected yet"}
              </div>
            )}
          </div>

          {donationRows.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left p-4 text-sm font-medium text-muted-foreground">Donor</th>
                    <th className="text-left p-4 text-sm font-medium text-muted-foreground">Purpose</th>
                    <th className="text-left p-4 text-sm font-medium text-muted-foreground">Date</th>
                    <th className="text-right p-4 text-sm font-medium text-muted-foreground">Amount</th>
                    <th className="text-right p-4 text-sm font-medium text-muted-foreground">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {donationRows.map((donation) => (
                    <tr key={donation.id} className="hover:bg-muted/50 transition-colors">
                      <td className="p-4">
                        <p className="font-medium text-foreground">{donation.donor_name || "Anonymous"}</p>
                        {donation.donor_email && (
                          <p className="text-sm text-muted-foreground">{donation.donor_email}</p>
                        )}
                      </td>
                      <td className="p-4 text-muted-foreground">{donation.purpose || "General support"}</td>
                      <td className="p-4 text-muted-foreground">
                        {donation.created_at
                          ? new Date(donation.created_at).toLocaleDateString()
                          : "—"}
                      </td>
                      <td className="p-4 text-right font-mono font-medium text-foreground">
                        ${(donation.amount_cents / 100).toLocaleString(undefined, {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })}
                      </td>
                      <td className="p-4 text-right">
                        <Badge variant={donation.status === "succeeded" ? "success" : donation.status === "failed" ? "error" : "muted"}>
                          {donation.status}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState
              title={`No ${pageLabel.toLowerCase()} yet`}
              description={`${pageLabel} will appear after Stripe completes a payment.`}
              action={
                <Link href={`/${orgSlug}/philanthropy`} className="text-sm text-muted-foreground hover:text-foreground">
                  View philanthropy events →
                </Link>
              }
            />
          )}
        </Card>
      </div>
    </div>
  );
}
