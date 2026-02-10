import { notFound, redirect } from "next/navigation";
import { cookies } from "next/headers";
import { OrgSidebar } from "@/components/layout/OrgSidebar";
import { MobileNav } from "@/components/layout/MobileNav";
import { GracePeriodBanner } from "@/components/layout/GracePeriodBanner";
import { BillingGate } from "@/components/layout/BillingGate";
import { DevPanel } from "@/components/layout/DevPanel";
import { getOrgContext } from "@/lib/auth/roles";
import { canDevAdminPerform } from "@/lib/auth/dev-admin";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { OrgAnalyticsProvider } from "@/components/analytics/OrgAnalyticsContext";
import { ConsentModal } from "@/components/analytics/ConsentModal";
import { AnalyticsProvider } from "@/components/analytics/AnalyticsProvider";

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
  const primaryLight = organization.primary_color ? adjustColor(organization.primary_color, 20) : "#2d4a6f";
  const primaryDark = organization.primary_color ? adjustColor(organization.primary_color, -20) : "#0f2a4f";
  const secondaryLight = organization.secondary_color ? adjustColor(organization.secondary_color, 20) : "#34d399";
  const secondaryDark = organization.secondary_color ? adjustColor(organization.secondary_color, -20) : "#047857";
  const isPrimaryDark = isColorDark(primary);
  const isSecondaryDark = isColorDark(secondary);
  const baseForeground = isPrimaryDark ? "#f8fafc" : "#0f172a";
  // Use black text on bright secondary colors for better readability
  const secondaryForeground = isSecondaryDark ? "#ffffff" : "#0f172a";
  const cardColor = isPrimaryDark ? adjustColor(primary, 18) : adjustColor(primary, -12);
  const cardForeground = isColorDark(cardColor) ? "#f8fafc" : "#0f172a";
  // For light themes, use a more visible muted color that provides better contrast
  const muted = isPrimaryDark ? adjustColor(primary, 28) : adjustColor(primary, -35);
  const mutedForeground = isColorDark(muted) ? "#e2e8f0" : "#475569";
  // For light themes, use a darker border for better visibility
  const borderColor = isPrimaryDark ? adjustColor(primary, 35) : adjustColor(primary, -45);

  return (
    <OrgAnalyticsProvider orgId={organization.id} orgType={(organization as Record<string, unknown>).org_type as string || "general"}>
    <AnalyticsProvider>
    <div
      data-org-shell
      className="min-h-screen"
      style={{
        // Set org primary color as CSS variable
        "--color-org-primary": primary,
        "--color-org-primary-light": primaryLight,
        "--color-org-primary-dark": primaryDark,
        "--color-org-secondary": secondary,
        "--color-org-secondary-light": secondaryLight,
        "--color-org-secondary-dark": secondaryDark,
        "--color-org-secondary-foreground": secondaryForeground,
        // Apply org colors to global surface tokens for this layout
        "--background": primary,
        "--foreground": baseForeground,
        "--card": cardColor,
        "--card-foreground": cardForeground,
        "--muted": muted,
        "--muted-foreground": mutedForeground,
        "--border": borderColor,
        "--ring": secondary,
        backgroundColor: primary,
        color: baseForeground,
      } as React.CSSProperties}
    >
      <style
        // Mirror theme variables to :root so portals/modals also pick up org branding
        dangerouslySetInnerHTML={{
          __html: `
            :root {
              --color-org-primary: ${primary};
              --color-org-primary-light: ${primaryLight};
              --color-org-primary-dark: ${primaryDark};
              --color-org-secondary: ${secondary};
              --color-org-secondary-light: ${secondaryLight};
              --color-org-secondary-dark: ${secondaryDark};
              --color-org-secondary-foreground: ${secondaryForeground};
              --background: ${primary};
              --foreground: ${baseForeground};
              --card: ${cardColor};
              --card-foreground: ${cardForeground};
              --muted: ${muted};
              --muted-foreground: ${mutedForeground};
              --border: ${borderColor};
              --ring: ${secondary};
            }
          `,
        }}
      />

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
        <OrgSidebar organization={organization} role={orgContext.role} isDevAdmin={isDevAdmin} />
      </div>

      <MobileNav organization={organization} role={orgContext.role} isDevAdmin={isDevAdmin} />
      <ConsentModal />

      <main className={`lg:ml-64 p-4 lg:p-8 pt-20 lg:pt-8 ${orgContext.gracePeriod.isInGracePeriod ? "mt-12" : ""}`}>
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

// Helper function to lighten/darken a hex color
function adjustColor(hex: string, amount: number): string {
  const clamp = (num: number) => Math.min(255, Math.max(0, num));
  
  let color = hex.replace("#", "");
  if (color.length === 3) {
    color = color.split("").map(c => c + c).join("");
  }
  
  const num = parseInt(color, 16);
  const r = clamp((num >> 16) + amount);
  const g = clamp(((num >> 8) & 0x00FF) + amount);
  const b = clamp((num & 0x0000FF) + amount);
  
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}`;
}

function isColorDark(hex: string): boolean {
  let color = hex.replace("#", "");
  if (color.length === 3) {
    color = color
      .split("")
      .map((c) => c + c)
      .join("");
  }
  const num = parseInt(color, 16);
  const r = (num >> 16) & 255;
  const g = (num >> 8) & 255;
  const b = num & 255;
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance < 0.6;
}
