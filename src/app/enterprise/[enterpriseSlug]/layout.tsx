import { redirect } from "next/navigation";
import dynamic from "next/dynamic";
import { AIPanelProvider } from "@/components/ai-assistant";
import { EnterpriseSidebar } from "@/components/enterprise/EnterpriseSidebar";
import { getEnterpriseContext } from "@/lib/auth/enterprise-context";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";

const AIPanel = dynamic(
  () => import("@/components/ai-assistant/AIPanel").then((module) => module.AIPanel),
  { ssr: false },
);
const AIEdgeTab = dynamic(
  () => import("@/components/ai-assistant/AIEdgeTab").then((module) => module.AIEdgeTab),
  { ssr: false },
);

interface EnterpriseLayoutProps {
  children: React.ReactNode;
  params: Promise<{ enterpriseSlug: string }>;
}

export default async function EnterpriseLayout({ children, params }: EnterpriseLayoutProps) {
  const { enterpriseSlug } = await params;
  const context = await getEnterpriseContext(enterpriseSlug);

  if (!context) {
    redirect("/app?error=no_enterprise_access");
  }

  const { enterprise, role } = context;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  let aiOrgId: string | null = null;

  if (user) {
    const serviceSupabase = createServiceClient();
    const { data: enterpriseOrganizations, error: enterpriseOrganizationsError } =
      await serviceSupabase
        .from("organizations")
        .select("id")
        .eq("enterprise_id", enterprise.id)
        .order("created_at", { ascending: true });

    if (enterpriseOrganizationsError) {
      console.error("[enterprise-layout] Failed to load enterprise organizations for AI panel:", enterpriseOrganizationsError);
    } else if ((enterpriseOrganizations ?? []).length > 0) {
      const { data: adminRoles, error: adminRolesError } = await serviceSupabase
        .from("user_organization_roles")
        .select("organization_id")
        .eq("user_id", user.id)
        .eq("role", "admin")
        .eq("status", "active")
        .in("organization_id", enterpriseOrganizations.map((organization) => organization.id));

      if (adminRolesError) {
        console.error("[enterprise-layout] Failed to load enterprise admin orgs for AI panel:", adminRolesError);
      } else {
        const adminOrganizationIds = new Set((adminRoles ?? []).map((row) => row.organization_id));
        aiOrgId =
          enterpriseOrganizations.find((organization) => adminOrganizationIds.has(organization.id))
            ?.id ?? null;
      }
    }
  }

  if (!aiOrgId && process.env.NODE_ENV !== "production") {
    console.warn(
      "[enterprise-layout] Skipping AI panel because no active admin org was found for enterprise user",
      { enterpriseId: enterprise.id, userId: user?.id ?? null },
    );
  }

  return (
    <AIPanelProvider autoOpen={aiOrgId != null}>
    <div className="min-h-screen bg-background">
      {/* Desktop Sidebar */}
      <div className="hidden lg:block">
        <EnterpriseSidebar
          enterpriseSlug={enterprise.slug}
          enterpriseName={enterprise.name}
          logoUrl={enterprise.logo_url}
          primaryColor={enterprise.primary_color}
          role={role}
        />
      </div>

      {/* Mobile Header - simplified for now */}
      <div className="lg:hidden fixed top-0 left-0 right-0 z-40 bg-card border-b border-border px-4 py-3">
        <div className="flex items-center gap-3">
          {enterprise.logo_url ? (
            <div className="h-8 w-8 rounded-lg overflow-hidden bg-muted">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={enterprise.logo_url}
                alt={enterprise.name}
                className="h-full w-full object-cover"
              />
            </div>
          ) : (
            <div
              className="h-8 w-8 rounded-lg flex items-center justify-center text-white font-bold"
              style={{ backgroundColor: enterprise.primary_color || "#6B21A8" }}
            >
              {enterprise.name.charAt(0)}
            </div>
          )}
          <span className="font-semibold text-foreground">{enterprise.name}</span>
        </div>
      </div>

      {/* Main Content */}
      <main className="lg:ml-[var(--sidebar-offset,3.5rem)] p-4 lg:p-8 pt-20 lg:pt-8 transition-[margin-left] duration-300 ease-in-out motion-reduce:transition-none">
        {children}
      </main>
      {aiOrgId && (
        <>
          <AIPanel orgId={aiOrgId} />
          <AIEdgeTab isAdmin />
        </>
      )}
    </div>
    </AIPanelProvider>
  );
}
