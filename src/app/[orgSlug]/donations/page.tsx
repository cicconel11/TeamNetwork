import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Card, Button, EmptyState, SoftDeleteButton } from "@/components/ui";
import { PageHeader } from "@/components/layout";
import { isOrgAdmin } from "@/lib/auth";

interface DonationsPageProps {
  params: Promise<{ orgSlug: string }>;
  searchParams: Promise<{ campaign?: string }>;
}

export default async function DonationsPage({ params, searchParams }: DonationsPageProps) {
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

  // Build query
  let query = supabase
    .from("donations")
    .select("*")
    .eq("organization_id", org.id)
    .is("deleted_at", null)
    .order("date", { ascending: false });

  if (filters.campaign) {
    query = query.eq("campaign", filters.campaign);
  }

  const { data: donations } = await query;

  // Get all donations for stats
  const { data: allDonations } = await supabase
    .from("donations")
    .select("amount, campaign")
    .eq("organization_id", org.id)
    .is("deleted_at", null);

  // Calculate stats
  const totalAmount = allDonations?.reduce((sum, d) => sum + Number(d.amount), 0) || 0;
  const donationCount = allDonations?.length || 0;
  const avgDonation = donationCount > 0 ? totalAmount / donationCount : 0;

  // Get unique campaigns for filter
  // Campaigns list available for future filtering features
// const campaigns = [...new Set(allDonations?.map((d) => d.campaign).filter(Boolean))];

  // Group donations by campaign for breakdown
  const campaignTotals = allDonations?.reduce((acc, d) => {
    const campaign = d.campaign || "General";
    acc[campaign] = (acc[campaign] || 0) + Number(d.amount);
    return acc;
  }, {} as Record<string, number>) || {};

  return (
    <div className="animate-fade-in">
      <PageHeader
        title="Donations"
        description={`${donationCount} donations totaling $${totalAmount.toLocaleString()}`}
        actions={
          isAdmin && (
            <Link href={`/${orgSlug}/donations/new`}>
              <Button>
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                </svg>
                Add Donation
              </Button>
            </Link>
          )
        }
      />

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
        <Card className="p-5">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center">
              <svg className="h-5 w-5 text-emerald-600 dark:text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v12m-3-2.818l.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.725 0-1.45-.22-2.003-.659-1.106-.879-1.106-2.303 0-3.182s2.9-.879 4.006 0l.415.33M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <div>
              <p className="text-2xl font-bold text-foreground font-mono">${totalAmount.toLocaleString()}</p>
              <p className="text-sm text-muted-foreground">Total Raised</p>
            </div>
          </div>
        </Card>
        <Card className="p-5">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center">
              <svg className="h-5 w-5 text-blue-600 dark:text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" />
              </svg>
            </div>
            <div>
              <p className="text-2xl font-bold text-foreground font-mono">{donationCount}</p>
              <p className="text-sm text-muted-foreground">Total Donations</p>
            </div>
          </div>
        </Card>
        <Card className="p-5">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-purple-100 dark:bg-purple-900/30 flex items-center justify-center">
              <svg className="h-5 w-5 text-purple-600 dark:text-purple-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" />
              </svg>
            </div>
            <div>
              <p className="text-2xl font-bold text-foreground font-mono">${avgDonation.toFixed(0)}</p>
              <p className="text-sm text-muted-foreground">Average Donation</p>
            </div>
          </div>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Campaign Breakdown */}
        <Card className="p-6 lg:col-span-1">
          <h3 className="font-semibold text-foreground mb-4">By Campaign</h3>
          <div className="space-y-3">
            {Object.entries(campaignTotals)
              .sort(([, a], [, b]) => b - a)
              .map(([campaign, amount]) => (
                <Link
                  key={campaign}
                  href={`/${orgSlug}/donations?campaign=${encodeURIComponent(campaign === "General" ? "" : campaign)}`}
                  className="flex items-center justify-between p-3 rounded-xl bg-muted/50 hover:bg-muted transition-colors"
                >
                  <span className="text-foreground">{campaign}</span>
                  <span className="font-mono font-medium text-foreground">
                    ${amount.toLocaleString()}
                  </span>
                </Link>
              ))}
          </div>
        </Card>

        {/* Donations List */}
        <Card className="p-0 lg:col-span-2 overflow-hidden">
          <div className="p-4 border-b border-border flex items-center justify-between">
            <h3 className="font-semibold text-foreground">
              {filters.campaign ? `${filters.campaign} Donations` : "All Donations"}
            </h3>
            {filters.campaign && (
              <Link href={`/${orgSlug}/donations`} className="text-sm text-muted-foreground hover:text-foreground">
                View all →
              </Link>
            )}
          </div>
          
          {donations && donations.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left p-4 text-sm font-medium text-muted-foreground">Donor</th>
                    <th className="text-left p-4 text-sm font-medium text-muted-foreground">Campaign</th>
                    <th className="text-left p-4 text-sm font-medium text-muted-foreground">Date</th>
                    <th className="text-right p-4 text-sm font-medium text-muted-foreground">Amount</th>
                    {isAdmin && (
                      <th className="text-right p-4 text-sm font-medium text-muted-foreground">Actions</th>
                    )}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {donations.map((donation) => (
                    <tr key={donation.id} className="hover:bg-muted/50 transition-colors">
                      <td className="p-4">
                        <p className="font-medium text-foreground">{donation.donor_name}</p>
                        {donation.donor_email && (
                          <p className="text-sm text-muted-foreground">{donation.donor_email}</p>
                        )}
                      </td>
                      <td className="p-4 text-muted-foreground">{donation.campaign || "General"}</td>
                      <td className="p-4 text-muted-foreground">
                        {new Date(donation.date).toLocaleDateString()}
                      </td>
                      <td className="p-4 text-right font-mono font-medium text-foreground">
                        ${Number(donation.amount).toLocaleString()}
                      </td>
                      {isAdmin && (
                        <td className="p-4 text-right">
                          <SoftDeleteButton
                            table="donations"
                            id={donation.id}
                            organizationField="organization_id"
                            organizationId={org.id}
                            redirectTo={`/${orgSlug}/donations`}
                            label="Delete"
                          />
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState
              title="No donations yet"
              description="Donations will appear here once recorded"
              action={
                isAdmin && (
                  <Link href={`/${orgSlug}/donations/new`}>
                    <Button>Record First Donation</Button>
                  </Link>
                )
              }
            />
          )}
        </Card>
      </div>
    </div>
  );
}

