import Link from "next/link";
import Image from "next/image";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Card, Button, Badge, EmptyState } from "@/components/ui";

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
};

export default async function AppHomePage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    redirect("/auth/login");
  }

  const { data: memberships, error: membershipError } = await supabase
    .from("user_organization_roles")
    .select("organization:organizations(id, name, slug, description, logo_url, primary_color), role")
    .eq("user_id", user.id)
    .is("deleted_at", null);

  // Debug: Log membership query results
  console.log("[app/page] User:", user.id, user.email);
  console.log("[app/page] Memberships:", memberships?.length || 0, membershipError?.message || "OK");

  const orgs = (memberships as Membership[] | null)?.filter((m) => m.organization).map((m) => ({
    ...m.organization!,
    role: m.role ?? "member",
  })) ?? [];

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <h1 className="text-2xl font-bold text-foreground">
            Team<span className="text-emerald-500">Network</span>
          </h1>
          <div className="flex items-center gap-2">
            <Link href="/app/join">
              <Button variant="ghost" size="sm">Join Org</Button>
            </Link>
            <Link href="/app/create-org">
              <Button size="sm">Create Org</Button>
            </Link>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-8 sm:py-12">
        <div className="mb-8 flex items-center justify-between">
          <div>
            <p className="text-sm text-muted-foreground">Welcome back</p>
            <h2 className="text-2xl font-bold text-foreground">Your organizations</h2>
          </div>
          <div className="hidden sm:flex items-center gap-2">
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
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {orgs.map((org) => (
              <Link key={org.id} href={`/${org.slug}`}>
                <Card interactive className="p-5 space-y-3">
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
      </main>
    </div>
  );
}

