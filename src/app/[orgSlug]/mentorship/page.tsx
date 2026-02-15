import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/layout";
import { getOrgContext } from "@/lib/auth/roles";
import { MentorshipAdminPanel } from "@/components/mentorship/MentorshipAdminPanel";
import { MentorPairManager } from "@/components/mentorship/MentorPairManager";
import { MenteeStatusToggle } from "@/components/mentorship/MenteeStatusToggle";
import { MentorshipPairsList } from "@/components/mentorship/MentorshipPairsList";
import { MentorDirectory } from "@/components/mentorship/MentorDirectory";
import { resolveLabel } from "@/lib/navigation/label-resolver";
import type { NavConfig } from "@/lib/navigation/nav-items";

interface MentorshipPageProps {
  params: Promise<{ orgSlug: string }>;
}

export default async function MentorshipPage({ params }: MentorshipPageProps) {
  const { orgSlug } = await params;
  const orgCtx = await getOrgContext(orgSlug);
  const supabase = await createClient();

  if (!orgCtx.organization) return null;

  const orgId = orgCtx.organization.id;

  const { data: pairs } = await supabase
    .from("mentorship_pairs")
    .select("*")
    .eq("organization_id", orgId)
    .order("created_at", { ascending: false });

  const pairIds = pairs?.map((p) => p.id) || [];

  const userIds = new Set<string>();
  pairs?.forEach((p) => {
    userIds.add(p.mentor_user_id);
    userIds.add(p.mentee_user_id);
  });

  // Check if current user has a mentor profile
  const { data: currentUserProfile } = await supabase
    .from("mentor_profiles")
    .select("id")
    .eq("organization_id", orgId)
    .eq("user_id", orgCtx.userId!)
    .maybeSingle();

  // Query active mentor profiles with users data
  const { data: mentorProfiles } = await supabase
    .from("mentor_profiles")
    .select("*, users!mentor_profiles_user_id_fkey(id, name, email)")
    .eq("organization_id", orgId)
    .eq("is_active", true);

  // Get alumni data for mentors
  const mentorUserIds = mentorProfiles?.map((p) => p.user_id) || [];
  const { data: mentorAlumni } = mentorUserIds.length > 0
    ? await supabase
        .from("alumni")
        .select("user_id, first_name, last_name, photo_url, industry, graduation_year, current_company, current_city")
        .eq("organization_id", orgId)
        .is("deleted_at", null)
        .in("user_id", mentorUserIds)
    : { data: [] };

  // Run logs and users queries in parallel
  const [{ data: logs }, { data: users }] = await Promise.all([
    pairIds.length > 0
      ? supabase
          .from("mentorship_logs")
          .select("*")
          .eq("organization_id", orgId)
          .in("pair_id", pairIds)
          .order("entry_date", { ascending: false })
          .order("created_at", { ascending: false })
      : Promise.resolve({ data: [] }),
    userIds.size > 0
      ? supabase.from("users").select("id,name,email").in("id", Array.from(userIds))
      : Promise.resolve({ data: [] }),
  ]);

  const filteredPairs =
    orgCtx.isAdmin
      ? pairs || []
      : (pairs || []).filter((p) =>
          orgCtx.role === "active_member"
            ? p.mentee_user_id === orgCtx.userId
            : p.mentor_user_id === orgCtx.userId
        );

  // Prepare logs for the client component
  const logsForClient = (logs || []).map((log) => ({
    id: log.id,
    pair_id: log.pair_id,
    entry_date: log.entry_date,
    notes: log.notes,
    progress_metric: log.progress_metric,
    created_by: log.created_by,
  }));

  // Prepare users for the client component
  const usersForClient = (users || []).map((u) => ({
    id: u.id,
    name: u.name,
    email: u.email,
  }));

  // Prepare mentor directory data
  const alumniMap = new Map(
    (mentorAlumni || []).map((a) => [a.user_id, a])
  );

  const mentorsForDirectory = (mentorProfiles || []).map((profile) => {
    const user = profile.users as { id: string; name: string; email: string | null } | null;
    const alumni = alumniMap.get(profile.user_id);

    return {
      id: profile.id,
      user_id: profile.user_id,
      name: user?.name || "Unknown",
      email: user?.email || null,
      photo_url: alumni?.photo_url || null,
      industry: alumni?.industry || null,
      graduation_year: alumni?.graduation_year || null,
      current_company: alumni?.current_company || null,
      current_city: alumni?.current_city || null,
      expertise_areas: profile.expertise_areas || null,
      bio: profile.bio || null,
      contact_email: profile.contact_email || null,
      contact_linkedin: profile.contact_linkedin || null,
      contact_phone: profile.contact_phone || null,
    };
  });

  // Extract unique industries and years for filters
  const industries = Array.from(
    new Set(
      mentorsForDirectory
        .map((m) => m.industry)
        .filter((i): i is string => i !== null)
    )
  ).sort();

  const years = Array.from(
    new Set(
      mentorsForDirectory
        .map((m) => m.graduation_year)
        .filter((y): y is number => y !== null)
    )
  ).sort((a, b) => b - a);

  const navConfig = orgCtx.organization.nav_config as NavConfig | null;
  const pageLabel = resolveLabel("/mentorship", navConfig);

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title={pageLabel}
        description={`Manage and track ${pageLabel.toLowerCase()} pairs`}
      />

      {orgCtx.role === "active_member" && <MenteeStatusToggle orgId={orgId} />}

      {orgCtx.isAdmin && <MentorshipAdminPanel orgId={orgId} orgSlug={orgSlug} />}
      {!orgCtx.isAdmin && orgCtx.role === "alumni" && (
        <MentorPairManager orgId={orgId} orgSlug={orgSlug} />
      )}

      <MentorDirectory
        mentors={mentorsForDirectory}
        industries={industries}
        years={years}
        showRegistration={orgCtx.role === "alumni" && !currentUserProfile}
        orgId={orgId}
        orgSlug={orgSlug}
      />

      <MentorshipPairsList
        initialPairs={filteredPairs}
        logs={logsForClient}
        users={usersForClient}
        isAdmin={orgCtx.isAdmin}
        canLogActivity={orgCtx.isAdmin || orgCtx.isActiveMember}
        orgId={orgId}
      />
    </div>
  );
}
