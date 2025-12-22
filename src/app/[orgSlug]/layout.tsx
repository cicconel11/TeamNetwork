import { notFound } from "next/navigation";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { OrgSidebar } from "@/components/layout/OrgSidebar";
import { MobileNav } from "@/components/layout/MobileNav";
import { getOrgContext } from "@/lib/auth/roles";

interface OrgLayoutProps {
  children: React.ReactNode;
  params: Promise<{ orgSlug: string }>;
}

export default async function OrgLayout({ children, params }: OrgLayoutProps) {
  const { orgSlug } = await params;
  const orgContext = await getOrgContext(orgSlug);

  if (!orgContext.organization) notFound();

  if (!orgContext.userId) {
    const cookieStore = await cookies();
    const hasSbCookies = cookieStore.getAll().some((c) => c.name.startsWith("sb-"));
    if (!hasSbCookies) {
      redirect(`/auth/login?redirect=/${orgSlug}`);
    }
    // Allow render to continue to avoid redirect loop while session refreshes
  }

  if (orgContext.status === "revoked") {
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

  if (!orgContext.role) {
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

  const organization = orgContext.organization;

  return (
    <div 
      className="min-h-screen bg-background"
      style={{
        // Set org primary color as CSS variable
        "--color-org-primary": organization.primary_color || "#1e3a5f",
        "--color-org-primary-light": organization.primary_color 
          ? adjustColor(organization.primary_color, 20) 
          : "#2d4a6f",
        "--color-org-primary-dark": organization.primary_color 
          ? adjustColor(organization.primary_color, -20) 
          : "#0f2a4f",
      } as React.CSSProperties}
    >
      <div className="hidden lg:block fixed left-0 top-0 h-screen w-64 z-40">
        <OrgSidebar organization={organization} role={orgContext.role} />
      </div>

      <MobileNav organization={organization} role={orgContext.role} />

      <main className="lg:ml-64 p-4 lg:p-8 pt-20 lg:pt-8">
        {children}
      </main>
    </div>
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

