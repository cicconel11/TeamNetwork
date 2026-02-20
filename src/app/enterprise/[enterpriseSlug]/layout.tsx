import { redirect } from "next/navigation";
import { EnterpriseSidebar } from "@/components/enterprise/EnterpriseSidebar";
import { getEnterpriseContext } from "@/lib/auth/enterprise-context";

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

  return (
    <div className="min-h-screen bg-background">
      {/* Desktop Sidebar */}
      <div className="hidden lg:block fixed left-0 top-0 h-screen w-64 z-40">
        <EnterpriseSidebar
          enterpriseSlug={enterprise.slug}
          enterpriseName={enterprise.name}
          logoUrl={enterprise.logo_url}
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
            <div className="h-8 w-8 rounded-lg flex items-center justify-center bg-purple-600 text-white font-bold">
              {enterprise.name.charAt(0)}
            </div>
          )}
          <span className="font-semibold text-foreground">{enterprise.name}</span>
        </div>
      </div>

      {/* Main Content */}
      <main className="lg:ml-64 p-4 lg:p-8 pt-20 lg:pt-8">
        {children}
      </main>
    </div>
  );
}
