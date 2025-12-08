import Link from "next/link";
import Image from "next/image";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Button, Card } from "@/components/ui";

export default async function OrgPickerPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    redirect("/auth/login");
  }

  // Get all organizations where user has a role
  const { data: userOrgs } = await supabase
    .from("user_organization_roles")
    .select(`
      role,
      organizations (
        id,
        name,
        slug,
        description,
        logo_url,
        primary_color
      )
    `)
    .eq("user_id", user.id);

  const hasOrgs = userOrgs && userOrgs.length > 0;

  // If user has exactly one org, redirect directly to it
  if (userOrgs && userOrgs.length === 1 && userOrgs[0].organizations) {
    const org = userOrgs[0].organizations as unknown as { slug: string };
    redirect(`/${org.slug}`);
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border bg-card">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <h1 className="text-2xl font-bold text-foreground">
            Team<span className="text-emerald-500">Network</span>
          </h1>
          <div className="flex items-center gap-4">
            <Link href="/settings/notifications">
              <Button variant="ghost" size="sm">
                Settings
              </Button>
            </Link>
            <form action="/auth/signout" method="POST">
              <Button variant="ghost" size="sm" type="submit">
                Sign Out
              </Button>
            </form>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-6xl mx-auto px-6 py-12">
        {hasOrgs ? (
          <>
            <div className="flex items-center justify-between mb-8">
              <div>
                <h2 className="text-3xl font-bold text-foreground mb-2">Your Organizations</h2>
                <p className="text-muted-foreground">
                  Select an organization to manage, or join/create a new one.
                </p>
              </div>
              <div className="flex gap-3">
                <Link href="/app/join">
                  <Button variant="secondary">
                    <svg className="h-4 w-4 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M18 18.72a9.094 9.094 0 003.741-.479 3 3 0 00-4.682-2.72m.94 3.198l.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0112 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 016 18.719m12 0a5.971 5.971 0 00-.941-3.197m0 0A5.995 5.995 0 0012 12.75a5.995 5.995 0 00-5.058 2.772m0 0a3 3 0 00-4.681 2.72 8.986 8.986 0 003.74.477m.94-3.197a5.971 5.971 0 00-.94 3.197M15 6.75a3 3 0 11-6 0 3 3 0 016 0zm6 3a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0zm-13.5 0a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0z" />
                    </svg>
                    Join
                  </Button>
                </Link>
                <Link href="/app/create-org">
                  <Button>
                    <svg className="h-4 w-4 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                    </svg>
                    Create
                  </Button>
                </Link>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
              {userOrgs!.map((userOrg) => {
                const org = userOrg.organizations as unknown as {
                  id: string;
                  name: string;
                  slug: string;
                  description: string | null;
                  logo_url: string | null;
                  primary_color: string | null;
                };
                
                if (!org) return null;

                return (
                  <Link
                    key={org.id}
                    href={`/${org.slug}`}
                    className="group"
                  >
                    <Card className="p-6 h-full hover:border-emerald-500/50 transition-colors">
                      <div className="flex items-center gap-4 mb-4">
                        {org.logo_url ? (
                          <div className="relative h-14 w-14 overflow-hidden rounded-xl">
                            <Image
                              src={org.logo_url}
                              alt={org.name}
                              fill
                              className="object-cover"
                              sizes="56px"
                              priority={false}
                            />
                          </div>
                        ) : (
                          <div
                            className="h-14 w-14 rounded-xl flex items-center justify-center text-white font-bold text-xl"
                            style={{ backgroundColor: org.primary_color || "#1e3a5f" }}
                          >
                            {org.name.charAt(0)}
                          </div>
                        )}
                        <div>
                          <h3 className="font-semibold text-foreground group-hover:text-emerald-500 transition-colors">
                            {org.name}
                          </h3>
                          <div className="flex items-center gap-2">
                            <span className="text-sm text-muted-foreground">/{org.slug}</span>
                            <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 font-medium capitalize">
                              {userOrg.role}
                            </span>
                          </div>
                        </div>
                      </div>
                      {org.description && (
                        <p className="text-sm text-muted-foreground line-clamp-2">
                          {org.description}
                        </p>
                      )}
                      <div className="mt-4 flex items-center text-sm text-muted-foreground group-hover:text-foreground transition-colors">
                        <span>Open Dashboard</span>
                        <svg className="h-4 w-4 ml-1 group-hover:translate-x-1 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
                        </svg>
                      </div>
                    </Card>
                  </Link>
                );
              })}
            </div>
          </>
        ) : (
          /* Empty state - no organizations */
          <div className="max-w-xl mx-auto text-center py-12">
            <div className="h-20 w-20 rounded-2xl bg-muted flex items-center justify-center mx-auto mb-6">
              <svg className="h-10 w-10 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M18 18.72a9.094 9.094 0 003.741-.479 3 3 0 00-4.682-2.72m.94 3.198l.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0112 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 016 18.719m12 0a5.971 5.971 0 00-.941-3.197m0 0A5.995 5.995 0 0012 12.75a5.995 5.995 0 00-5.058 2.772m0 0a3 3 0 00-4.681 2.72 8.986 8.986 0 003.74.477m.94-3.197a5.971 5.971 0 00-.94 3.197M15 6.75a3 3 0 11-6 0 3 3 0 016 0zm6 3a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0zm-13.5 0a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0z" />
              </svg>
            </div>
            <h2 className="text-2xl font-bold text-foreground mb-3">Welcome to TeamNetwork!</h2>
            <p className="text-muted-foreground mb-8">
              You&apos;re not part of any organizations yet. Join an existing organization with an invite code, or create your own.
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <Link href="/app/join">
                <Button size="lg" variant="secondary" className="w-full sm:w-auto">
                  <svg className="h-5 w-5 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M18 18.72a9.094 9.094 0 003.741-.479 3 3 0 00-4.682-2.72m.94 3.198l.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0112 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 016 18.719m12 0a5.971 5.971 0 00-.941-3.197m0 0A5.995 5.995 0 0012 12.75a5.995 5.995 0 00-5.058 2.772m0 0a3 3 0 00-4.681 2.72 8.986 8.986 0 003.74.477m.94-3.197a5.971 5.971 0 00-.94 3.197M15 6.75a3 3 0 11-6 0 3 3 0 016 0zm6 3a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0zm-13.5 0a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0z" />
                  </svg>
                  Join with Invite Code
                </Button>
              </Link>
              <Link href="/app/create-org">
                <Button size="lg" className="w-full sm:w-auto">
                  <svg className="h-5 w-5 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                  </svg>
                  Create Organization
                </Button>
              </Link>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
