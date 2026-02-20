import Link from "next/link";
import Image from "next/image";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Card, Button, Badge, EmptyState } from "@/components/ui";
import { AppPageAnimations } from "@/components/app/AppPageAnimations";
import { AppBackgroundEffects } from "@/components/app/AppBackgroundEffects";
import { CheckoutSuccessBanner } from "@/components/app/CheckoutSuccessBanner";
import { EnterpriseCard } from "@/components/enterprise";
import { getUserEnterprises } from "@/lib/auth/enterprise-context";
import { SeedEnterpriseButton } from "@/components/dev/SeedEnterpriseButton";
import { ThemeToggle } from "@/components/theme/ThemeToggle";

export const dynamic = "force-dynamic";

type OrganizationSummary = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  logo_url: string | null;
  primary_color: string | null;
  enterprise_id: string | null;
};

type Membership = {
  organization_id: string;
  organization: OrganizationSummary | null;
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

  let loadError: string | null = null;

  // Fetch user's enterprises and organizations in parallel
  const [{ data: membershipsData, error: membershipsError }, enterprises] = await Promise.all([
    supabase
      .from("user_organization_roles")
      .select("organization_id, organization:organizations(id, name, slug, description, logo_url, primary_color, enterprise_id), role, status")
      .eq("user_id", user.id),
    getUserEnterprises(user.id),
  ]);

  let memberships = (membershipsData as Membership[] | null) ?? [];

  if (membershipsError) {
    console.error("[app] Failed to load memberships with org embed:", membershipsError);
    const { data: fallbackMemberships, error: fallbackError } = await supabase
      .from("user_organization_roles")
      .select("organization_id, role, status")
      .eq("user_id", user.id);

    if (fallbackError) {
      console.error("[app] Failed to load memberships (fallback):", fallbackError);
      loadError = "We couldn't load your organizations. Please refresh or try again later.";
      memberships = [];
    } else {
      const fallbackRows = (fallbackMemberships as Array<Pick<Membership, "organization_id" | "role" | "status">> | null) ?? [];
      memberships = fallbackRows.map((row) => ({ ...row, organization: null }));
    }
  }

  const activeMemberships = memberships.filter((m) => m.status === "active");
  const pendingMemberships = memberships.filter((m) => m.status === "pending");

  const orgLookup = new Map<string, OrganizationSummary>();
  for (const membership of memberships) {
    if (membership.organization) {
      orgLookup.set(membership.organization_id, membership.organization);
    }
  }

  const missingOrgIds = Array.from(
    new Set(
      memberships
        .filter((m) => !orgLookup.has(m.organization_id))
        .map((m) => m.organization_id)
        .filter(Boolean),
    ),
  );

  if (missingOrgIds.length > 0) {
    const { data: orgData, error: orgError } = await supabase
      .from("organizations")
      .select("id, name, slug, description, logo_url, primary_color")
      .in("id", missingOrgIds);

    if (orgError) {
      console.error("[app] Failed to resolve organizations for memberships:", orgError);
      if (!loadError) {
        loadError = "We couldn't load your organizations. Please refresh or try again later.";
      }
    } else {
      for (const org of orgData ?? []) {
        orgLookup.set(org.id, org as OrganizationSummary);
      }
    }
  }

  const allOrgs = activeMemberships
    .map((m) => {
      const org = orgLookup.get(m.organization_id);
      if (!org) return null;
      return { ...org, role: m.role ?? "member" };
    })
    .filter(Boolean) as Array<OrganizationSummary & { role: string }>;

  // Split into regular orgs and enterprise sub-orgs
  const orgs = allOrgs.filter((o) => !o.enterprise_id);
  const knownEnterpriseIds = new Set(
    enterprises.map((e) => e.enterprise?.id).filter(Boolean)
  );
  const enterpriseSubOrgs = allOrgs
    .filter((o) => o.enterprise_id && knownEnterpriseIds.has(o.enterprise_id))
    .reduce<Record<string, typeof allOrgs>>((acc, org) => ({
      ...acc,
      [org.enterprise_id!]: [...(acc[org.enterprise_id!] ?? []), org],
    }), {});

  // Get pending memberships for display
  const pendingDisplayMemberships = pendingMemberships
    .map((m) => {
      const org = orgLookup.get(m.organization_id);
      if (!org) return null;
      return { ...org, role: m.role ?? "member" };
    })
    .filter(Boolean) as Array<OrganizationSummary & { role: string }>;

  // If checkout=success, find the org by slug to get its ID for reconciliation
  let checkoutOrgId: string | undefined;
  if (checkout === "success" && orgSlug) {
    const targetOrg = orgs.find((org) => org.slug === orgSlug)
      ?? pendingDisplayMemberships.find((org) => org.slug === orgSlug);
    checkoutOrgId = targetOrg?.id;
    
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
            <ThemeToggle />
            <form action="/auth/signout" method="POST">
              <Button variant="ghost" size="sm" type="submit">Sign Out</Button>
            </form>
            <Link href="/app/join">
              <Button variant="ghost" size="sm">Join Org</Button>
            </Link>
            <Link href="/app/create">
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

        {loadError && (
          <Card className="p-4 mb-6 border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/20">
            <div className="flex items-center gap-3">
              <svg className="h-5 w-5 text-amber-600 dark:text-amber-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <p className="text-sm text-amber-700 dark:text-amber-300">{loadError}</p>
            </div>
          </Card>
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
            <Link href="/app/create">
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
              <div className="flex flex-col gap-3">
                <div className="flex gap-3">
                  <Link href="/app/create">
                    <Button>Create organization</Button>
                  </Link>
                  <Link href="/app/join">
                    <Button variant="secondary">Join organization</Button>
                  </Link>
                </div>
                {enterprises.length === 0 && (
                  <Link href="/app/create-enterprise" className="text-sm text-purple-600 hover:text-purple-700 text-center">
                    Or create an enterprise to manage multiple organizations
                  </Link>
                )}
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

        {/* Your Enterprises Section */}
        <section className="mt-10">
          <div className="flex items-center justify-between mb-4">
            <div className="app-hero-animate" style={{ opacity: 0 }}>
              <h2 className="text-xl font-semibold text-foreground">Your Enterprises</h2>
            </div>
            <Link href="/app/create-enterprise" className="app-hero-animate text-sm text-purple-600 hover:text-purple-700" style={{ opacity: 0 }}>
              Create Enterprise
            </Link>
          </div>
          {enterprises.length > 0 ? (
            <div className="space-y-4">
              {enterprises
                .filter((item) => item.enterprise !== null)
                .map((item) => {
                  const entId = item.enterprise!.id;
                  const subOrgs = enterpriseSubOrgs[entId] ?? [];
                  return (
                    <div key={entId}>
                      <div>
                        <EnterpriseCard
                          name={item.enterprise!.name}
                          slug={item.enterprise!.slug}
                          logoUrl={item.enterprise!.logo_url}
                          role={item.role}
                          subOrgCount={subOrgs.length}
                          alumniCount={0}
                        />
                      </div>
                      {subOrgs.length > 0 && (
                        <div className="mt-2 pl-4 border-l-2 border-purple-200 dark:border-purple-800 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                          {subOrgs.map((org) => (
                            <Link key={org.id} href={`/${org.slug}`}>
                              <Card interactive className="p-3 space-y-1">
                                <div className="flex items-center gap-2">
                                  {org.logo_url ? (
                                    <div className="relative h-8 w-8 rounded-lg overflow-hidden bg-muted flex-shrink-0">
                                      <Image
                                        src={org.logo_url}
                                        alt={org.name}
                                        fill
                                        className="object-cover"
                                        sizes="32px"
                                      />
                                    </div>
                                  ) : (
                                    <div
                                      className="h-8 w-8 rounded-lg flex items-center justify-center text-white font-bold text-sm flex-shrink-0"
                                      style={{ backgroundColor: org.primary_color || "#1e3a5f" }}
                                    >
                                      {org.name.charAt(0)}
                                    </div>
                                  )}
                                  <div className="min-w-0">
                                    <p className="text-sm font-semibold text-foreground truncate">{org.name}</p>
                                    <p className="text-xs text-muted-foreground truncate">/{org.slug}</p>
                                  </div>
                                  <Badge variant="muted" className="ml-auto capitalize text-xs">{org.role}</Badge>
                                </div>
                              </Card>
                            </Link>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
            </div>
          ) : (
            <Card className="app-hero-animate p-6 text-center" style={{ opacity: 0 }}>
              <div className="flex flex-col items-center gap-3">
                <div className="h-12 w-12 rounded-full bg-purple-100 dark:bg-purple-900/30 flex items-center justify-center">
                  <svg className="h-6 w-6 text-purple-600 dark:text-purple-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 21h16.5M4.5 3h15M5.25 3v18m13.5-18v18M9 6.75h1.5m-1.5 3h1.5m-1.5 3h1.5m3-6H15m-1.5 3H15m-1.5 3H15M9 21v-3.375c0-.621.504-1.125 1.125-1.125h3.75c.621 0 1.125.504 1.125 1.125V21" />
                  </svg>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">
                    Manage multiple organizations under one billing account
                  </p>
                </div>
                <div className="flex flex-col gap-2">
                  <Link href="/app/create-enterprise">
                    <Button variant="secondary" size="sm">Create your first enterprise</Button>
                  </Link>
                  {process.env.NODE_ENV === "development" && <SeedEnterpriseButton />}
                </div>
              </div>
            </Card>
          )}
        </section>

        {/* Pending memberships section */}
        {pendingDisplayMemberships.length > 0 && (
          <div className="mt-8">
            <h3 className="text-lg font-semibold text-foreground mb-4 flex items-center gap-2">
              Pending Approval
              <Badge variant="warning">{pendingDisplayMemberships.length}</Badge>
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {pendingDisplayMemberships.map((org) => (
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
