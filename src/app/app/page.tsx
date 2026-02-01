import Link from "next/link";
import Image from "next/image";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Card, Button, Badge, EmptyState } from "@/components/ui";
import { AppPageAnimations } from "@/components/app/AppPageAnimations";
import { AppBackgroundEffects } from "@/components/app/AppBackgroundEffects";
import { CheckoutSuccessBanner } from "@/components/app/CheckoutSuccessBanner";

type Membership = {
  organization: {
    id: string;
    name: string;
    slug: string;
    description: string | null;
    logo_url: string | null;
    primary_color: string | null;
  } | null;
  role: string | null;
  status: string | null;
};

interface AppHomePageProps {
  searchParams: Promise<{ error?: string; pending?: string; checkout?: string; org?: string }>;
}

export default async function AppHomePage({ searchParams }: AppHomePageProps) {
  const { error: errorParam, pending: pendingOrg, checkout, org: orgSlug } = await searchParams;
  const supabase = await createClient();
  // Use getUser() instead of getSession() - validates JWT and refreshes tokens for OAuth
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    redirect("/auth/login");
  }

  const { data: memberships } = await supabase
    .from("user_organization_roles")
    .select("organization:organizations(id, name, slug, description, logo_url, primary_color), role, status")
    .eq("user_id", user.id);

  // Filter to only show active memberships
  const orgs = (memberships as Membership[] | null)
    ?.filter((m) => m.organization && m.status === "active")
    .map((m) => ({
      ...m.organization!,
      role: m.role ?? "member",
    })) ?? [];

  // Get pending memberships for display
  const pendingMemberships = (memberships as Membership[] | null)
    ?.filter((m) => m.organization && m.status === "pending")
    .map((m) => ({
      ...m.organization!,
      role: m.role ?? "member",
    })) ?? [];

  // If checkout=success, find the org by slug to get its ID for reconciliation
  let checkoutOrgId: string | undefined;
  if (checkout === "success" && orgSlug) {
    const targetOrg = (memberships as Membership[] | null)?.find(
      (m) => m.organization?.slug === orgSlug
    );
    checkoutOrgId = targetOrg?.organization?.id;
    
    // If org not in memberships yet (webhook may not have fired), look it up directly
    if (!checkoutOrgId) {
      const { data: orgData } = await supabase
        .from("organizations")
        .select("id")
        .eq("slug", orgSlug)
        .maybeSingle();
      checkoutOrgId = orgData?.id;
    }
  }

  return (
    <div className="min-h-screen bg-background relative overflow-hidden">
      <AppBackgroundEffects />
      <AppPageAnimations />
      <header className="relative z-10 border-b border-border bg-card/80 backdrop-blur-sm">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <h1 className="app-hero-animate text-2xl font-bold text-foreground" style={{ opacity: 0 }}>
            Team<span className="text-emerald-500">Network</span>
          </h1>
          <div className="app-hero-animate flex items-center gap-2" style={{ opacity: 0 }}>
            <form action="/auth/signout" method="POST">
              <Button variant="ghost" size="sm" type="submit">Sign Out</Button>
            </form>
            <Link href="/app/join">
              <Button variant="ghost" size="sm">Join Org</Button>
            </Link>
            <Link href="/app/create-org">
              <Button size="sm">Create Org</Button>
            </Link>
          </div>
        </div>
      </header>

      <main className="relative z-10 max-w-6xl mx-auto px-4 sm:px-6 py-8 sm:py-12">
        {/* Checkout success banner with auto-sync */}
        {checkout === "success" && orgSlug && (
          <CheckoutSuccessBanner orgSlug={orgSlug} organizationId={checkoutOrgId} />
        )}

        {/* Error banner for revoked access */}
        {errorParam === "access_revoked" && (
          <Card className="p-4 mb-6 border-red-300 dark:border-red-700 bg-red-50 dark:bg-red-900/20">
            <div className="flex items-center gap-3">
              <svg className="h-5 w-5 text-red-600 dark:text-red-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
              </svg>
              <p className="text-sm text-red-700 dark:text-red-300">
                Your access to this organization has been revoked. Please contact an admin if you believe this is an error.
              </p>
            </div>
          </Card>
        )}

        {/* Pending approval banner */}
        {pendingOrg && (
          <Card className="p-4 mb-6 border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/20">
            <div className="flex items-center gap-3">
              <svg className="h-5 w-5 text-amber-600 dark:text-amber-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <p className="text-sm text-amber-700 dark:text-amber-300">
                Your request to join <strong>{pendingOrg}</strong> is pending admin approval. You&apos;ll be able to access it once approved.
              </p>
            </div>
          </Card>
        )}

        <div className="mb-8 flex items-center justify-between">
          <div className="app-hero-animate" style={{ opacity: 0 }}>
            <p className="text-sm text-muted-foreground">Welcome back</p>
            <h2 className="text-2xl font-bold text-foreground">Your organizations</h2>
          </div>
          <div className="app-hero-animate hidden sm:flex items-center gap-2" style={{ opacity: 0 }}>
            <Link href="/app/join">
              <Button variant="secondary" size="sm">Join existing</Button>
            </Link>
            <Link href="/app/create-org">
              <Button size="sm">Create new</Button>
            </Link>
          </div>
        </div>

        {orgs.length === 0 ? (
          <EmptyState
            icon={
              <svg className="h-12 w-12" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6l4 2" />
              </svg>
            }
            title="No organizations yet"
            description="Create a new organization or join one you were invited to."
            action={
              <div className="flex gap-3">
                <Link href="/app/create-org">
                  <Button>Create organization</Button>
                </Link>
                <Link href="/app/join">
                  <Button variant="secondary">Join organization</Button>
                </Link>
              </div>
            }
          />
        ) : (
          <div className="orgs-grid grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {orgs.map((org) => (
              <Link key={org.id} href={`/${org.slug}`}>
                <Card interactive className="org-card p-5 space-y-3" style={{ opacity: 0 }}>
                  <div className="flex items-center gap-3">
                    {org.logo_url ? (
                      <div className="relative h-12 w-12 rounded-xl overflow-hidden bg-muted">
                        <Image
                          src={org.logo_url}
                          alt={org.name}
                          fill
                          className="object-cover"
                          sizes="48px"
                        />
                      </div>
                    ) : (
                      <div
                        className="h-12 w-12 rounded-xl flex items-center justify-center text-white font-bold text-lg"
                        style={{ backgroundColor: org.primary_color || "#1e3a5f" }}
                      >
                        {org.name.charAt(0)}
                      </div>
                    )}
                    <div className="min-w-0">
                      <p className="font-semibold text-foreground truncate">{org.name}</p>
                      <p className="text-sm text-muted-foreground truncate">/{org.slug}</p>
                    </div>
                    <Badge variant="muted" className="ml-auto capitalize">{org.role}</Badge>
                  </div>
                  {org.description && (
                    <p className="text-sm text-muted-foreground line-clamp-2">{org.description}</p>
                  )}
                </Card>
              </Link>
            ))}
          </div>
        )}

        {/* Pending memberships section */}
        {pendingMemberships.length > 0 && (
          <div className="mt-8">
            <h3 className="text-lg font-semibold text-foreground mb-4 flex items-center gap-2">
              Pending Approval
              <Badge variant="warning">{pendingMemberships.length}</Badge>
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {pendingMemberships.map((org) => (
                <Card key={org.id} className="p-5 space-y-3 opacity-70">
                  <div className="flex items-center gap-3">
                    {org.logo_url ? (
                      <div className="relative h-12 w-12 rounded-xl overflow-hidden bg-muted">
                        <Image
                          src={org.logo_url}
                          alt={org.name}
                          fill
                          className="object-cover"
                          sizes="48px"
                        />
                      </div>
                    ) : (
                      <div
                        className="h-12 w-12 rounded-xl flex items-center justify-center text-white font-bold text-lg"
                        style={{ backgroundColor: org.primary_color || "#1e3a5f" }}
                      >
                        {org.name.charAt(0)}
                      </div>
                    )}
                    <div className="min-w-0">
                      <p className="font-semibold text-foreground truncate">{org.name}</p>
                      <p className="text-sm text-muted-foreground truncate">/{org.slug}</p>
                    </div>
                    <Badge variant="warning" className="ml-auto">Pending</Badge>
                  </div>
                  <p className="text-sm text-muted-foreground">Awaiting admin approval</p>
                </Card>
              ))}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
