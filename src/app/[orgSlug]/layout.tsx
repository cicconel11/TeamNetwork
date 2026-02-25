import { notFound, redirect } from "next/navigation";
import { cookies } from "next/headers";
import { OrgSidebar } from "@/components/layout/OrgSidebar";
import { MobileNav } from "@/components/layout/MobileNav";
import { GracePeriodBanner } from "@/components/layout/GracePeriodBanner";
import { CancelingBanner } from "@/components/layout/CancelingBanner";
import { BillingGate } from "@/components/layout/BillingGate";
import { DevPanel } from "@/components/layout/DevPanel";
import { getOrgContext } from "@/lib/auth/roles";
import { canDevAdminPerform } from "@/lib/auth/dev-admin";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { OrgAnalyticsProvider } from "@/components/analytics/OrgAnalyticsContext";
import { ConsentModal } from "@/components/analytics/ConsentModal";
import { AnalyticsProvider } from "@/components/analytics/AnalyticsProvider";
import { computeOrgThemeVariables } from "@/lib/theming/org-colors";

interface OrgLayoutProps {
  children: React.ReactNode;
  params: Promise<{ orgSlug: string }>;
}

export default async function OrgLayout({ children, params }: OrgLayoutProps) {
  const { orgSlug } = await params;
  const orgContext = await getOrgContext(orgSlug);

  if (!orgContext.organization) notFound();

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const isDevAdmin = canDevAdminPerform(user, "view_org");
  const isAdmin = orgContext.role === "admin" || isDevAdmin;

  if (!orgContext.userId) {
    const cookieStore = await cookies();
    const hasSbCookies = cookieStore.getAll().some((c) => c.name.startsWith("sb-"));
    if (!hasSbCookies) {
      redirect(`/auth/login?redirect=/${orgSlug}`);
    }
    // Allow render to continue to avoid redirect loop while session refreshes
  }

  if (orgContext.status === "revoked" && !isDevAdmin) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background px-6">
        <div className="max-w-lg text-center space-y-4">
          <h1 className="text-2xl font-bold text-foreground">Access removed</h1>
          <p className="text-muted-foreground">
            Your access to this organization has been revoked. If you believe this is an error, please contact an admin.
          </p>
        </div>
      </div>
    );
  }

  if (!orgContext.role && !isDevAdmin) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background px-6">
        <div className="max-w-lg text-center space-y-4">
          <h1 className="text-2xl font-bold text-foreground">No membership found</h1>
          <p className="text-muted-foreground">
            You are signed in but do not have access to this organization. Please ask an admin to invite you.
          </p>
        </div>
      </div>
    );
  }

  // Handle grace period expiration - block access but don't auto-delete
  // Deletion should only happen via explicit admin action (DELETE API call)
  if (orgContext.gracePeriod.isGracePeriodExpired) {
    if (isDevAdmin) {
      if (!orgContext.subscription) {
        return (
          <div className="min-h-screen flex items-center justify-center bg-background px-6">
            <div className="max-w-lg text-center space-y-4">
              <h1 className="text-2xl font-bold text-foreground">Billing issue detected</h1>
              <p className="text-muted-foreground">
                This organization has a canceled subscription with missing grace period data. Use the dev panel to reconcile or restore billing.
              </p>
            </div>
          </div>
        );
      }
    } else {
      return (
        <BillingGate 
          orgSlug={orgSlug} 
          organizationId={orgContext.organization.id} 
          status="canceled"
          gracePeriodExpired={true}
          isAdmin={isAdmin}
        />
      );
    }
  }

  // Show BillingGate for non-active subscriptions (except during grace period)
  // Normalize invalid statuses: "complete" or "completed" should be treated as "active"
  // (these can occur if webhook stored checkout session status instead of subscription status)
  let subscriptionStatus = orgContext.subscription?.status || "";
  if (subscriptionStatus === "complete" || subscriptionStatus === "completed") {
    // If we have a subscription with a period end, it's likely active
    // Otherwise, we'll show billing gate to let them reconcile
    if (orgContext.subscription?.currentPeriodEnd) {
      subscriptionStatus = "active";
    }
  }
  
  const activeStatuses = ["active", "trialing", "canceling"];
  const shouldShowBillingGate = 
    subscriptionStatus && 
    !activeStatuses.includes(subscriptionStatus) && 
    !orgContext.gracePeriod.isInGracePeriod;

  if (shouldShowBillingGate && !isDevAdmin) {
    return (
      <BillingGate 
        orgSlug={orgSlug} 
        organizationId={orgContext.organization.id} 
        status={subscriptionStatus}
        isAdmin={isAdmin}
      />
    );
  }

  const organization = orgContext.organization;

  let serviceSupabase = null;
  if (isDevAdmin) {
    try {
      serviceSupabase = createServiceClient();
    } catch (e) {
      console.warn("DevAdmin: Failed to create service client (missing key?)", e);
    }
  }

  const memberStats = serviceSupabase
    ? await serviceSupabase
        .from("members")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", organization.id)
        .is("deleted_at", null)
    : null;
  const memberCount = memberStats?.count ?? undefined;

  const { data: devSubscriptionDetails } = serviceSupabase
    ? await serviceSupabase
        .from("organization_subscriptions")
        .select("stripe_customer_id, stripe_subscription_id")
        .eq("organization_id", organization.id)
        .maybeSingle()
    : { data: null };
  const primary = organization.primary_color || "#1e3a5f";
  const secondary = organization.secondary_color || "#10b981";

  // Compute theme variables for both light and dark modes
  const lightModeVars = computeOrgThemeVariables(primary, secondary, false);
  const darkModeVars = computeOrgThemeVariables(primary, secondary, true);

  return (
    <OrgAnalyticsProvider orgId={organization.id} orgType={(organization as Record<string, unknown>).org_type as string || "general"}>
    <AnalyticsProvider>
    <div data-org-shell className="min-h-screen">
      <style
        dangerouslySetInnerHTML={{
          __html: `
            :root {
              ${Object.entries(lightModeVars)
                .map(([key, value]) => `${key}: ${value};`)
                .join("\n              ")}
            }

            :root.dark {
              ${Object.entries(darkModeVars)
                .map(([key, value]) => `${key}: ${value};`)
                .join("\n              ")}
            }

            @media (prefers-color-scheme: dark) {
              :root:not(.light) {
                ${Object.entries(darkModeVars)
                  .map(([key, value]) => `${key}: ${value};`)
                  .join("\n                ")}
              }
            }
          `,
        }}
      />

      {/* Canceling banner - shown when subscription is scheduled to cancel at period end */}
      {orgContext.gracePeriod.isCanceling && orgContext.subscription?.currentPeriodEnd && (
        <div className="fixed top-0 left-0 right-0 z-50 lg:left-64">
          <CancelingBanner
            periodEndDate={orgContext.subscription.currentPeriodEnd}
            orgSlug={orgSlug}
            organizationId={organization.id}
            isAdmin={isAdmin}
          />
        </div>
      )}

      {/* Grace period banner - shown when subscription is canceled but within 30-day grace */}
      {orgContext.gracePeriod.isInGracePeriod && (
        <div className="fixed top-0 left-0 right-0 z-50 lg:left-64">
          <GracePeriodBanner
            daysRemaining={orgContext.gracePeriod.daysRemaining}
            orgSlug={orgSlug}
            organizationId={organization.id}
            isAdmin={isAdmin}
          />
        </div>
      )}

      <div className="hidden lg:block fixed left-0 top-0 h-screen w-64 z-40">
        <OrgSidebar organization={organization} role={orgContext.role} isDevAdmin={isDevAdmin} hasAlumniAccess={orgContext.hasAlumniAccess} hasParentsAccess={orgContext.hasParentsAccess} />
      </div>

      <MobileNav organization={organization} role={orgContext.role} isDevAdmin={isDevAdmin} hasAlumniAccess={orgContext.hasAlumniAccess} hasParentsAccess={orgContext.hasParentsAccess} />
      <ConsentModal />

      <main className={`lg:ml-64 p-4 lg:p-8 pt-20 lg:pt-8 ${orgContext.gracePeriod.isInGracePeriod || orgContext.gracePeriod.isCanceling ? "mt-12" : ""}`}>
        {children}
      </main>

      {isDevAdmin && (
        <DevPanel
          organizationId={organization.id}
          orgSlug={orgSlug}
          orgName={organization.name}
          subscriptionStatus={orgContext.subscription?.status ?? null}
          stripeCustomerId={devSubscriptionDetails?.stripe_customer_id ?? null}
          stripeSubscriptionId={devSubscriptionDetails?.stripe_subscription_id ?? null}
          currentPeriodEnd={orgContext.subscription?.currentPeriodEnd ?? null}
          gracePeriodEndsAt={orgContext.subscription?.gracePeriodEndsAt ?? null}
          userRole={orgContext.role}
          memberCount={memberCount}
        />
      )}
    </div>
    </AnalyticsProvider>
    </OrgAnalyticsProvider>
  );
}
