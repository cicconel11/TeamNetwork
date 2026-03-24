import { Users, GraduationCap, CalendarClock, HandHeart, Heart } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { getOrgContext, getCurrentUser } from "@/lib/auth/roles";
import { resolveDataClient } from "@/lib/auth/dev-admin";
import { fetchMediaForEntities } from "@/lib/media/fetch";

import { getCachedDonationStats } from "@/lib/cached-queries";

import { FeedComposer } from "@/components/feed/FeedComposer";
import { FeedList } from "@/components/feed/FeedList";
import { FeedSidebar } from "@/components/feed/FeedSidebar";
import { CompactStatsWidget } from "@/components/feed/CompactStatsWidget";
import type { StatItem } from "@/components/feed/CompactStatsWidget";
import type { PollMetadata } from "@/components/feed/types";

export const dynamic = "force-dynamic";

interface HomePageProps {
  params: Promise<{ orgSlug: string }>;
  searchParams: Promise<{ page?: string }>;
}

export default async function OrgHomePage({ params, searchParams }: HomePageProps) {
  const { orgSlug } = await params;
  const { page: pageParam } = await searchParams;

  const orgCtx = await getOrgContext(orgSlug);
  if (!orgCtx.organization) return null;
  const org = orgCtx.organization;

  const supabase = await createClient();
  const user = await getCurrentUser();
  const queryClient = resolveDataClient(user, supabase, "view_org");

  // Parse pagination
  const page = parseInt(pageParam || "1", 10);
  const limit = 25;
  const offset = (page - 1) * limit;

  // Fetch stats + feed posts in parallel
  const [
    { count: membersCount },
    { count: alumniCount },
    { count: parentsCount },
    { count: eventsCount },
    { data: posts, error: postsError, count: postsCount },
    userName,
  ] = await Promise.all([
    queryClient.from("members").select("*", { count: "exact", head: true }).eq("organization_id", org.id).is("deleted_at", null).is("graduated_at", null).eq("status", "active"),
    queryClient.from("alumni").select("*", { count: "exact", head: true }).eq("organization_id", org.id).is("deleted_at", null),
    queryClient.from("parents").select("*", { count: "exact", head: true }).eq("organization_id", org.id).is("deleted_at", null),
    queryClient.from("events").select("*", { count: "exact", head: true }).eq("organization_id", org.id).is("deleted_at", null).gte("start_date", new Date().toISOString()),
    supabase
      .from("feed_posts")
      .select(`*, author:users!feed_posts_author_id_fkey(name)`, { count: "exact", head: false })
      .eq("organization_id", org.id)
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1),
    orgCtx.userId
      ? supabase.from("users").select("name").eq("id", orgCtx.userId).maybeSingle().then((r) => r.data)
      : Promise.resolve(null),
  ]);

  const donationStat = await getCachedDonationStats(org.id);

  if (postsError) {
    throw new Error("Failed to load feed");
  }

  // Fetch user likes + media for posts
  const postIds = (posts || []).map((p) => p.id);
  let userLikedPostIds: Set<string> = new Set();

  if (postIds.length > 0 && orgCtx.userId) {
    const { data: likes, error: likesError } = await supabase
      .from("feed_likes")
      .select("post_id")
      .eq("user_id", orgCtx.userId)
      .in("post_id", postIds);

    if (likesError) {
      console.error("Failed to fetch user likes:", likesError);
    }

    userLikedPostIds = new Set((likes || []).map((l) => l.post_id));
  }

  const mediaMap = postIds.length > 0
    ? await fetchMediaForEntities(createServiceClient(), "feed_post", postIds, org.id)
    : new Map();

  // Augment poll data for poll-type posts
  const pollPostIds = (posts || []).filter((p) => (p as Record<string, unknown>).post_type === "poll").map((p) => p.id);
  const userVoteMap = new Map<string, number>();
  const voteCountsMap = new Map<string, number[]>();
  const totalVotesMap = new Map<string, number>();

  if (pollPostIds.length > 0 && orgCtx.userId) {
    const [{ data: userVotes }, { data: allVotes }] = await Promise.all([
      supabase
        .from("feed_poll_votes")
        .select("post_id, option_index")
        .eq("user_id", orgCtx.userId)
        .in("post_id", pollPostIds),
      supabase
        .from("feed_poll_votes")
        .select("post_id, option_index")
        .in("post_id", pollPostIds)
        .limit(5000),
    ]);

    for (const v of userVotes || []) {
      userVoteMap.set(v.post_id, v.option_index);
    }

    for (const v of allVotes || []) {
      if (!voteCountsMap.has(v.post_id)) {
        const postForMeta = (posts || []).find((p) => p.id === v.post_id);
        const meta = (postForMeta as Record<string, unknown>)?.metadata as PollMetadata | null;
        voteCountsMap.set(v.post_id, new Array(meta?.options.length || 0).fill(0));
        totalVotesMap.set(v.post_id, 0);
      }
      const counts = voteCountsMap.get(v.post_id)!;
      if (v.option_index < counts.length) {
        counts[v.option_index]++;
      }
      totalVotesMap.set(v.post_id, (totalVotesMap.get(v.post_id) || 0) + 1);
    }
  }

  const augmentedPosts = (posts || []).map((post) => ({
    ...post,
    liked_by_user: userLikedPostIds.has(post.id),
    media: mediaMap.get(post.id) ?? [],
    ...((post as Record<string, unknown>).post_type === "poll"
      ? {
          poll_meta: (post as Record<string, unknown>).metadata as PollMetadata | null,
          user_vote: userVoteMap.get(post.id) ?? null,
          vote_counts: voteCountsMap.get(post.id) ?? [],
          total_votes: totalVotesMap.get(post.id) ?? 0,
        }
      : {}),
  }));

  const total = postsCount || 0;
  const totalPages = Math.ceil(total / limit);

  // Determine if user can create posts
  const feedPostRoles: string[] =
    (org as Record<string, unknown>).feed_post_roles as string[] ||
    ["admin", "active_member", "alumni"];
  const canPost = orgCtx.role ? feedPostRoles.includes(orgCtx.role) : false;

  // Build stats for sidebar widget
  const totalDonations = (donationStat?.total_amount_cents ?? 0) / 100;

  const stats: StatItem[] = [
    { label: "Active Members", value: membersCount || 0, href: `/${orgSlug}/members`, icon: Users },
    { label: "Alumni", value: alumniCount || 0, href: `/${orgSlug}/alumni`, icon: GraduationCap },
    ...(orgCtx.hasParentsAccess && (parentsCount ?? 0) > 0 && (orgCtx.role === "admin" || orgCtx.role === "active_member" || orgCtx.role === "parent") ? [{
      label: "Parents", value: parentsCount || 0, href: `/${orgSlug}/parents`, icon: Heart,
    }] : []),
    { label: "Upcoming Events", value: eventsCount || 0, href: `/${orgSlug}/events`, icon: CalendarClock },
    {
      label: "Total Donations",
      value: `$${totalDonations.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`,
      href: `/${orgSlug}/donations`,
      icon: HandHeart,
    },
  ];

  return (
    <div className="animate-fade-in">
      <div className="grid grid-cols-1 xl:grid-cols-[1fr_320px] gap-6">
        {/* Main feed column */}
        <div>
          {canPost && (
            <div className="mb-5">
              <FeedComposer orgId={org.id} userName={userName?.name || undefined} />
            </div>
          )}
          <div className="flex items-center gap-3 mb-4">
            <div className="h-px flex-1 bg-border/50" />
            <span className="text-[10px] font-mono font-semibold uppercase tracking-widest text-muted-foreground/50">
              Recent
            </span>
            <div className="h-px flex-1 bg-border/50" />
          </div>
          <FeedList
            posts={augmentedPosts}
            orgSlug={orgSlug}
            currentUserId={orgCtx.userId || ""}
            isAdmin={orgCtx.isAdmin}
            basePath={`/${orgSlug}`}
            pagination={{ page, total, totalPages }}
          />
        </div>

        {/* Right sidebar */}
        <aside className="hidden xl:block">
          <div className="sticky top-8 space-y-4">
            <CompactStatsWidget stats={stats} />
            <FeedSidebar
              orgSlug={orgSlug}
              orgId={org.id}
              role={orgCtx.role}
              status={orgCtx.status}
              userId={orgCtx.userId}
            />
          </div>
        </aside>
      </div>
    </div>
  );
}
