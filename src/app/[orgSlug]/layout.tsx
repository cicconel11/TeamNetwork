import { notFound, redirect } from "next/navigation";
import { cookies } from "next/headers";
import { OrgSidebar } from "@/components/layout/OrgSidebar";
import { OrgMainContent } from "@/components/layout/OrgMainContent";
import { MobileNav } from "@/components/layout/MobileNav";
import { GracePeriodBanner } from "@/components/layout/GracePeriodBanner";
import { CancelingBanner } from "@/components/layout/CancelingBanner";
import { BillingGate } from "@/components/layout/BillingGate";
import { DevPanel } from "@/components/layout/DevPanel";
import { getOrgContext, getCurrentUser } from "@/lib/auth/roles";
import { canDevAdminPerform } from "@/lib/auth/dev-admin";
import { createServiceClient } from "@/lib/supabase/service";
import { createClient } from "@/lib/supabase/server";
import { OrgAnalyticsProvider } from "@/components/analytics/OrgAnalyticsContext";
import { ConsentModal } from "@/components/analytics/ConsentModal";
import { LinkedInUrlPrompt } from "@/components/linkedin/LinkedInUrlPrompt";
import { AnalyticsProvider } from "@/components/analytics/AnalyticsProvider";
import { AIPanelProvider } from "@/components/ai-assistant";
import { JoinOrgGate } from "@/components/join/JoinOrgGate";
import { MediaUploadManagerProvider } from "@/components/media/MediaUploadManagerContext";
import { pickCurrentOrgProfile } from "@/lib/auth/current-org-profile";
import dynamic from "next/dynamic";
const AIPanel = dynamic(
  () => import("@/components/ai-assistant/AIPanel").then((m) => m.AIPanel),
  { ssr: false },
);
const AIEdgeTab = dynamic(
  () => import("@/components/ai-assistant/AIEdgeTab").then((m) => m.AIEdgeTab),
  { ssr: false },
);
const OrgGlobalSearch = dynamic(
  () => import("@/components/search/OrgGlobalSearch").then((m) => m.OrgGlobalSearch),
  { ssr: false },
);
import { computeOrgThemeVariables, safeCssValue, safeHexColor } from "@/lib/theming/org-colors";

interface OrgLayoutProps {
  children: React.ReactNode;
  params: Promise<{ orgSlug: string }>;
}

export default async function OrgLayout({ children, params }: OrgLayoutProps) {
  const { orgSlug } = await params;
  const orgContext = await getOrgContext(orgSlug);

  if (!orgContext.organization) notFound();

  // Reuse cached user from getOrgContext — no extra auth.getUser() call
  const user = await getCurrentUser();
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

  if (orgContext.status === "pending" && !isDevAdmin) {
    return (
      <div className="min-h-screen bg-background">
        <header className="border-b border-border bg-card">
          <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
            <a href="/app" className="text-2xl font-bold text-foreground">
              Team<span className="text-emerald-500">Network</span>
            </a>
            <form action="/auth/signout" method="POST">
              <button type="submit" className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors">
                Sign Out
              </button>
            </form>
          </div>
        </header>

        <main className="max-w-md mx-auto px-6 py-16">
          <a href="/app" className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-1 mb-8">
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
            </svg>
            Back
          </a>

          <div className="rounded-2xl border border-border bg-card p-8 text-center">
            <div className="h-16 w-16 rounded-2xl bg-amber-500/10 flex items-center justify-center mx-auto mb-4">
              <svg className="h-8 w-8 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <h2 className="text-2xl font-bold text-foreground mb-2">Pending admin approval</h2>
            <p className="text-muted-foreground mb-6">
              Your request to join <span className="font-semibold text-foreground">{orgContext.organization.name}</span> has been submitted.
            </p>
            <div className="p-4 rounded-xl bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-300 text-sm mb-6">
              <p className="font-medium mb-1">Awaiting Admin Approval</p>
              <p className="text-amber-600 dark:text-amber-400">
                An admin will review your request and grant you access. You&apos;ll be able to access the organization once approved.
              </p>
            </div>
            <div className="flex justify-center gap-3">
              <a href="/app" className="inline-flex items-center justify-center rounded-xl border border-border bg-card px-4 py-2.5 text-sm font-medium text-foreground hover:bg-muted transition-colors">
                Back to Dashboard
              </a>
            </div>
          </div>
        </main>
      </div>
    );
  }

  if (!orgContext.role && !isDevAdmin) {
    return (
      <JoinOrgGate
        orgName={orgContext.organization.name}
        orgSlug={orgSlug}
      />
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
  
  const activeStatuses = ["active", "trialing", "canceling", "enterprise_managed"];
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

  let currentProfileHref: string | undefined;
  let currentProfileName: string | undefined;
  let currentProfileAvatar: string | undefined;
  let pendingApprovalsCount = 0;
  if (orgContext.userId) {
    const supabase = await createClient();
    const [{ data: memberRow }, { data: alumniRow }, { data: parentRow }] = await Promise.all([
      supabase
        .from("members")
        .select("id, first_name, last_name, photo_url")
        .eq("organization_id", organization.id)
        .eq("user_id", orgContext.userId)
        .is("deleted_at", null)
        .maybeSingle(),
      supabase
        .from("alumni")
        .select("id, first_name, last_name, photo_url")
        .eq("organization_id", organization.id)
        .eq("user_id", orgContext.userId)
        .is("deleted_at", null)
        .maybeSingle(),
      supabase
        .from("parents")
        .select("id, first_name, last_name, photo_url")
        .eq("organization_id", organization.id)
        .eq("user_id", orgContext.userId)
        .is("deleted_at", null)
        .maybeSingle(),
    ]);
    const currentProfile = pickCurrentOrgProfile({
      orgSlug,
      role: orgContext.role,
      memberProfile: memberRow ?? undefined,
      alumniProfile: alumniRow ?? undefined,
      parentProfile: parentRow ?? undefined,
    });
    if (!currentProfile) {
      console.warn("[layout] no profile row found for userId:", orgContext.userId, "orgId:", organization.id, "role:", orgContext.role);
    }
    currentProfileHref = currentProfile?.href;
    currentProfileName = currentProfile?.name;
    currentProfileAvatar = currentProfile?.avatarUrl ?? undefined;

    // Pending approvals count for admin sidebar badge (HEAD query, ~2ms)
    if (isAdmin) {
      const { count } = await supabase
        .from("user_organization_roles")
        .select("*", { count: "exact", head: true })
        .eq("organization_id", organization.id)
        .eq("status", "pending");
      pendingApprovalsCount = count ?? 0;
    }
  }

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
  const rawBase = (organization as Record<string, unknown>).base_color as string | null;
  const baseColor = rawBase === "primary" ? "primary" : safeHexColor(rawBase, "primary");
  const sidebarColor = safeHexColor(organization.primary_color, "#1e3a5f");
  const buttonColor = safeHexColor(organization.secondary_color, "#10b981");

  // Compute theme variables — base color determines light/dark, no separate modes
  const themeVars = computeOrgThemeVariables(baseColor, sidebarColor, buttonColor);

  return (
    <OrgAnalyticsProvider orgId={organization.id} orgType={(organization as Record<string, unknown>).org_type as string || "general"}>
    <AnalyticsProvider>
    <AIPanelProvider autoOpen={isAdmin}>
    <OrgGlobalSearch orgSlug={orgSlug} orgId={organization.id}>
    <div data-org-shell className="min-h-screen">
      <style
        dangerouslySetInnerHTML={{
          __html: (() => {
            // Validate every key (must be a CSS custom property) and every
            // value (allowlist of safe chars) before serializing so a bad
            // org_branding row cannot escape the declaration block.
            const KEY_RE = /^--[a-z0-9-]+$/i;
            const vars = Object.entries(themeVars)
              .filter(([key]) => KEY_RE.test(key))
              .map(([key, value]) => `${key}: ${safeCssValue(value, "inherit")};`)
              .join("\n              ");
            return `
            :root { ${vars} }
            :root.dark { ${vars} }
            @media (prefers-color-scheme: dark) { :root:not(.light) { ${vars} } }
            `;
          })(),
        }}
      />

      {/* Canceling banner - shown when subscription is scheduled to cancel at period end */}
      {orgContext.gracePeriod.isCanceling && orgContext.subscription?.currentPeriodEnd && (
        <div className="fixed top-0 left-0 right-0 z-50 lg:left-[var(--sidebar-offset,3.5rem)] transition-[left] duration-300 ease-in-out motion-reduce:transition-none">
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
        <div className="fixed top-0 left-0 right-0 z-50 lg:left-[var(--sidebar-offset,3.5rem)] transition-[left] duration-300 ease-in-out motion-reduce:transition-none">
          <GracePeriodBanner
            daysRemaining={orgContext.gracePeriod.daysRemaining}
            orgSlug={orgSlug}
            organizationId={organization.id}
            isAdmin={isAdmin}
          />
        </div>
      )}

      <div className="hidden lg:block">
        <OrgSidebar organization={organization} role={orgContext.role} isDevAdmin={isDevAdmin} hasAlumniAccess={orgContext.hasAlumniAccess} hasParentsAccess={orgContext.hasParentsAccess} currentProfileHref={currentProfileHref} currentProfileName={currentProfileName} currentProfileAvatar={currentProfileAvatar} pendingApprovalsCount={pendingApprovalsCount} />
      </div>

      <MobileNav organization={organization} role={orgContext.role} isDevAdmin={isDevAdmin} hasAlumniAccess={orgContext.hasAlumniAccess} hasParentsAccess={orgContext.hasParentsAccess} currentProfileHref={currentProfileHref} currentProfileName={currentProfileName} currentProfileAvatar={currentProfileAvatar} pendingApprovalsCount={pendingApprovalsCount} />
      {!isDevAdmin && <ConsentModal />}
      {!isDevAdmin && <LinkedInUrlPrompt />}

      <MediaUploadManagerProvider orgId={organization.id}>
        <OrgMainContent hasTopBanner={orgContext.gracePeriod.isInGracePeriod || orgContext.gracePeriod.isCanceling}>
          {children}
        </OrgMainContent>
      </MediaUploadManagerProvider>

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
      {isAdmin && (
        <>
          <AIPanel orgId={organization.id} />
          <AIEdgeTab isAdmin={isAdmin} />
        </>
      )}
    </div>
    </OrgGlobalSearch>
    </AIPanelProvider>
    </AnalyticsProvider>
    </OrgAnalyticsProvider>
  );
}
