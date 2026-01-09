import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { Users, GraduationCap, CalendarClock, HandHeart } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { Card, Badge } from "@/components/ui";
import { PageHeader } from "@/components/layout";
import { getOrgRole } from "@/lib/auth/roles";
import { filterAnnouncementsForUser } from "@/lib/announcements";

interface DashboardPageProps {
  params: Promise<{ orgSlug: string }>;
}

export default async function OrgDashboardPage({ params }: DashboardPageProps) {
  const { orgSlug } = await params;
  const supabase = await createClient();

  // Fetch organization
  const { data: orgs, error: orgError } = await supabase
    .from("organizations")
    .select("*")
    .eq("slug", orgSlug)
    .limit(1);

  const org = orgs?.[0];

  if (!org || orgError) return null;

  const membership = await getOrgRole({ orgId: org.id });

  // Fetch counts and recent data in parallel
  const [
    { count: membersCount },
    { count: alumniCount },
    { count: eventsCount },
    { data: recentAnnouncements },
    { data: upcomingEvents },
    { data: recentDonations },
    { data: donationStat },
  ] = await Promise.all([
    supabase.from("members").select("*", { count: "exact", head: true }).eq("organization_id", org.id).is("deleted_at", null),
    supabase.from("alumni").select("*", { count: "exact", head: true }).eq("organization_id", org.id).is("deleted_at", null),
    supabase.from("events").select("*", { count: "exact", head: true }).eq("organization_id", org.id).is("deleted_at", null),
    supabase.from("announcements").select("*").eq("organization_id", org.id).is("deleted_at", null).order("published_at", { ascending: false }).limit(3),
    supabase.from("events").select("*").eq("organization_id", org.id).is("deleted_at", null).gte("start_date", new Date().toISOString()).order("start_date").limit(5),
    supabase.from("organization_donations").select("*").eq("organization_id", org.id).order("created_at", { ascending: false }).limit(5),
    supabase.from("organization_donation_stats").select("*").eq("organization_id", org.id).maybeSingle(),
  ]);

  const visibleAnnouncements = filterAnnouncementsForUser(recentAnnouncements, {
    role: membership.role,
    status: membership.status,
    userId: membership.userId,
  });

  const totalDonations = ((donationStat as { total_amount_cents?: number } | null)?.total_amount_cents ?? 0) / 100;

  type StatCard = {
    label: string;
    value: number | string;
    href: string;
    icon: LucideIcon;
    accentFrom: string;
    accentTo: string;
  };

  const stats: StatCard[] = [
    {
      label: "Active Members",
      value: membersCount || 0,
      href: `/${orgSlug}/members`,
      icon: Users,
      accentFrom: "var(--color-org-secondary)",
      accentTo: "var(--color-org-secondary-dark)",
    },
    {
      label: "Alumni",
      value: alumniCount || 0,
      href: `/${orgSlug}/alumni`,
      icon: GraduationCap,
      accentFrom: "var(--color-org-secondary-light)",
      accentTo: "var(--color-org-secondary)",
    },
    {
      label: "Events",
      value: eventsCount || 0,
      href: `/${orgSlug}/events`,
      icon: CalendarClock,
      accentFrom: "var(--color-org-primary-light)",
      accentTo: "var(--color-org-primary)",
    },
    {
      label: "Total Donations",
      value: `$${totalDonations.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
      href: `/${orgSlug}/donations`,
      icon: HandHeart,
      accentFrom: "var(--color-org-secondary)",
      accentTo: "var(--color-org-secondary-dark)",
    },
  ];

  return (
    <div className="animate-fade-in">
      <PageHeader
        title={`Welcome to ${org.name}`}
        description={org.description || "Your organization dashboard"}
      />

      {/* Stats Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {stats.map((stat) => (
          <Link key={stat.label} href={stat.href}>
            <Card interactive className="p-5 bg-card/90 backdrop-blur">
              <div className="flex items-center gap-4">
                <div className="h-12 w-12 rounded-xl flex items-center justify-center text-white shadow-soft"
                  style={{
                    backgroundColor: stat.accentFrom,
                    boxShadow: "0 12px 30px -10px rgba(0,0,0,0.35)",
                  }}>
                    <stat.icon className="h-6 w-6" />
                </div>
                <div>
                  <p className="text-2xl font-bold text-foreground font-mono">{stat.value}</p>
                  <p className="text-sm text-muted-foreground">{stat.label}</p>
                </div>
              </div>
            </Card>
          </Link>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Recent Announcements */}
        <Card>
          <div className="p-6 border-b border-border">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold text-foreground">Recent Announcements</h2>
              <Link href={`/${orgSlug}/announcements`} className="text-sm text-muted-foreground hover:text-foreground">
                View all →
              </Link>
            </div>
          </div>
          <div className="divide-y divide-border">
            {visibleAnnouncements && visibleAnnouncements.length > 0 ? (
              visibleAnnouncements.map((announcement) => (
                <div key={announcement.id} className="p-4">
                  <div className="flex items-start gap-3">
                    {announcement.is_pinned && (
                      <Badge variant="primary" className="mt-0.5">Pinned</Badge>
                    )}
                    <div className="flex-1 min-w-0">
                      <h3 className="font-medium text-foreground truncate">{announcement.title}</h3>
                      <p className="text-sm text-muted-foreground line-clamp-2 mt-1">{announcement.body}</p>
                      <p className="text-xs text-muted-foreground mt-2">
                        {announcement.published_at
                          ? new Date(announcement.published_at).toLocaleDateString()
                          : "Scheduled"}
                      </p>
                    </div>
                  </div>
                </div>
              ))
            ) : (
              <div className="p-8 text-center text-muted-foreground">
                No announcements yet
              </div>
            )}
          </div>
        </Card>

        {/* Upcoming Events */}
        <Card>
          <div className="p-6 border-b border-border">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold text-foreground">Upcoming Events</h2>
              <Link href={`/${orgSlug}/events`} className="text-sm text-muted-foreground hover:text-foreground">
                View all →
              </Link>
            </div>
          </div>
          <div className="divide-y divide-border">
            {upcomingEvents && upcomingEvents.length > 0 ? (
              upcomingEvents.map((event) => (
                <Link key={event.id} href={`/${orgSlug}/events/${event.id}`} className="block p-4 hover:bg-muted/50 transition-colors">
                  <div className="flex items-center gap-4">
                    <div className="h-12 w-12 rounded-xl bg-muted flex flex-col items-center justify-center text-center">
                      <span className="text-xs font-medium text-muted-foreground uppercase">
                        {new Date(event.start_date).toLocaleDateString("en-US", { month: "short" })}
                      </span>
                      <span className="text-lg font-bold text-foreground leading-none">
                        {new Date(event.start_date).getDate()}
                      </span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <h3 className="font-medium text-foreground truncate">{event.title}</h3>
                      <p className="text-sm text-muted-foreground">
                        {event.location || "Location TBD"}
                      </p>
                    </div>
                    {event.is_philanthropy && (
                      <Badge variant="success">Philanthropy</Badge>
                    )}
                  </div>
                </Link>
              ))
            ) : (
              <div className="p-8 text-center text-muted-foreground">
                No upcoming events
              </div>
            )}
          </div>
        </Card>

        {/* Recent Donations */}
        <Card className="lg:col-span-2">
          <div className="p-6 border-b border-border">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold text-foreground">Recent Donations</h2>
              <Link href={`/${orgSlug}/donations`} className="text-sm text-muted-foreground hover:text-foreground">
                View all →
              </Link>
            </div>
          </div>
          <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left p-4 text-sm font-medium text-muted-foreground">Donor</th>
                    <th className="text-left p-4 text-sm font-medium text-muted-foreground">Purpose</th>
                    <th className="text-left p-4 text-sm font-medium text-muted-foreground">Date</th>
                    <th className="text-right p-4 text-sm font-medium text-muted-foreground">Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {recentDonations && recentDonations.length > 0 ? (
                    recentDonations.map((donation) => (
                      <tr key={donation.id}>
                        <td className="p-4 text-foreground">{donation.donor_name}</td>
                        <td className="p-4 text-muted-foreground">{donation.purpose || "General support"}</td>
                        <td className="p-4 text-muted-foreground">
                        {donation.created_at ? new Date(donation.created_at).toLocaleDateString() : "—"}
                        </td>
                        <td className="p-4 text-right font-mono font-medium text-foreground">
                        ${(donation.amount_cents / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </td>
                      </tr>
                    ))
                ) : (
                  <tr>
                    <td colSpan={4} className="p-8 text-center text-muted-foreground">
                      No donations recorded yet
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </div>
  );
}
