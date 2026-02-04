import Link from "next/link";
import { redirect } from "next/navigation";
import { Card, Badge, Button } from "@/components/ui";
import { PageHeader } from "@/components/layout";
import { AlumniUsageBar } from "@/components/enterprise/AlumniUsageBar";
import { SeatUsageBar } from "@/components/enterprise/SeatUsageBar";
import { getEnterpriseContext } from "@/lib/auth/enterprise-context";
import { createServiceClient } from "@/lib/supabase/service";
import { ENTERPRISE_TIER_LIMITS, type PricingModel } from "@/types/enterprise";

interface EnterpriseDashboardProps {
  params: Promise<{ enterpriseSlug: string }>;
}

export default async function EnterpriseDashboardPage({ params }: EnterpriseDashboardProps) {
  const { enterpriseSlug } = await params;
  const context = await getEnterpriseContext(enterpriseSlug);

  if (!context) {
    redirect("/app?error=no_enterprise_access");
  }

  const { enterprise, subscription, alumniCount, subOrgCount, enterpriseManagedOrgCount, role } = context;
  const alumniLimit = subscription?.alumni_tier
    ? ENTERPRISE_TIER_LIMITS[subscription.alumni_tier]
    : null;
  const pricingModel: PricingModel = subscription?.pricing_model ?? "alumni_tier";
  const subOrgQuantity = subscription?.sub_org_quantity ?? null;

  // Fetch recent sub-organizations
  const serviceSupabase = createServiceClient();
  const { data: recentOrgs } = await serviceSupabase
    .from("organizations")
    .select("id, name, slug, created_at")
    .eq("enterprise_id", enterprise.id)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(5);

  const formatSubscriptionStatus = (status: string | undefined) => {
    if (!status) return "No Subscription";
    switch (status) {
      case "active":
        return "Active";
      case "trialing":
        return "Trial";
      case "past_due":
        return "Past Due";
      case "canceled":
        return "Canceled";
      default:
        return status.charAt(0).toUpperCase() + status.slice(1);
    }
  };

  const getStatusVariant = (status: string | undefined): "success" | "warning" | "error" | "muted" => {
    if (!status) return "muted";
    switch (status) {
      case "active":
      case "trialing":
        return "success";
      case "past_due":
        return "warning";
      case "canceled":
        return "error";
      default:
        return "muted";
    }
  };

  return (
    <div className="animate-fade-in">
      <PageHeader
        title={`Welcome to ${enterprise.name}`}
        description="Enterprise dashboard overview"
        actions={
          <Link href={`/enterprise/${enterpriseSlug}/organizations/new`}>
            <Button>
              <PlusIcon className="h-4 w-4" />
              New Organization
            </Button>
          </Link>
        }
      />

      {/* Quick Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
        <Link href={`/enterprise/${enterpriseSlug}/organizations`}>
          <Card interactive className="p-5">
            <div className="flex items-center gap-4">
              <div className="h-12 w-12 rounded-xl bg-purple-100 dark:bg-purple-900/30 flex items-center justify-center">
                <BuildingIcon className="h-6 w-6 text-purple-600 dark:text-purple-400" />
              </div>
              <div>
                <p className="text-2xl font-bold text-foreground font-mono">{subOrgCount}</p>
                <p className="text-sm text-muted-foreground">Sub-Organizations</p>
              </div>
            </div>
          </Card>
        </Link>

        <Card className="p-5">
          <div className="flex items-center gap-4">
            <div className="h-12 w-12 rounded-xl bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center">
              <UsersIcon className="h-6 w-6 text-emerald-600 dark:text-emerald-400" />
            </div>
            <div>
              <p className="text-2xl font-bold text-foreground font-mono">{alumniCount.toLocaleString()}</p>
              <p className="text-sm text-muted-foreground">Total Alumni</p>
            </div>
          </div>
        </Card>

        <Link href={`/enterprise/${enterpriseSlug}/billing`}>
          <Card interactive className="p-5">
            <div className="flex items-center gap-4">
              <div className="h-12 w-12 rounded-xl bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center">
                <CreditCardIcon className="h-6 w-6 text-blue-600 dark:text-blue-400" />
              </div>
              <div className="flex items-center gap-2">
                <Badge variant={getStatusVariant(subscription?.status)}>
                  {formatSubscriptionStatus(subscription?.status)}
                </Badge>
              </div>
              <p className="text-sm text-muted-foreground">Subscription</p>
            </div>
          </Card>
        </Link>
      </div>

      {/* Alumni Usage Bar */}
      <Card className="p-6 mb-8">
        <AlumniUsageBar currentCount={alumniCount} limit={alumniLimit} />
        {role === "owner" || role === "billing_admin" ? (
          <div className="mt-4 flex justify-end">
            <Link href={`/enterprise/${enterpriseSlug}/billing`}>
              <Button variant="secondary" size="sm">
                Manage Quota
              </Button>
            </Link>
          </div>
        ) : null}
      </Card>

      {/* Seat Usage Summary Card */}
      <Card className="p-6 mb-8">
        <SeatUsageBar
          currentSeats={enterpriseManagedOrgCount}
          maxSeats={subOrgQuantity}
          pricingModel={pricingModel}
        />
        {(role === "owner" || role === "billing_admin") && pricingModel === "per_sub_org" ? (
          <div className="mt-4 flex justify-end">
            <Link href={`/enterprise/${enterpriseSlug}/billing`}>
              <Button variant="secondary" size="sm">
                Manage Seats
              </Button>
            </Link>
          </div>
        ) : null}
      </Card>

      {/* Recent Organizations */}
      <Card>
        <div className="p-6 border-b border-border">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-foreground">Recent Organizations</h2>
            <Link
              href={`/enterprise/${enterpriseSlug}/organizations`}
              className="text-sm text-muted-foreground hover:text-foreground"
            >
              View all
            </Link>
          </div>
        </div>
        <div className="divide-y divide-border">
          {recentOrgs && recentOrgs.length > 0 ? (
            recentOrgs.map((org) => (
              <Link
                key={org.id}
                href={`/${org.slug}`}
                className="block p-4 hover:bg-muted/50 transition-colors"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium text-foreground">{org.name}</p>
                    <p className="text-sm text-muted-foreground">/{org.slug}</p>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {org.created_at ? new Date(org.created_at).toLocaleDateString() : ""}
                  </p>
                </div>
              </Link>
            ))
          ) : (
            <div className="p-8 text-center text-muted-foreground">
              No organizations yet.{" "}
              <Link
                href={`/enterprise/${enterpriseSlug}/organizations/new`}
                className="text-purple-600 dark:text-purple-400 hover:underline"
              >
                Create your first one
              </Link>
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}

function PlusIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
    </svg>
  );
}

function BuildingIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M3.75 21h16.5M4.5 3h15M5.25 3v18m13.5-18v18M9 6.75h1.5m-1.5 3h1.5m-1.5 3h1.5m3-6H15m-1.5 3H15m-1.5 3H15M9 21v-3.375c0-.621.504-1.125 1.125-1.125h3.75c.621 0 1.125.504 1.125 1.125V21"
      />
    </svg>
  );
}

function UsersIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z"
      />
    </svg>
  );
}

function CreditCardIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M2.25 8.25h19.5M2.25 9h19.5m-16.5 5.25h6m-6 2.25h3m-3.75 3h15a2.25 2.25 0 002.25-2.25V6.75A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25v10.5A2.25 2.25 0 004.5 19.5z"
      />
    </svg>
  );
}
