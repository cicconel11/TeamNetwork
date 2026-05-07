import { loadFeedSidebarData, type FeedSidebarData } from "@/lib/feed/load-feed-sidebar-data";
import { FeedSidebarWidgets } from "./FeedSidebarWidgets";
import type { OrgRole } from "@/lib/auth/role-utils";

interface FeedSidebarProps {
  orgSlug: string;
  orgId: string;
  role: OrgRole | null;
  status: string | null;
  userId: string | null;
  /** When provided (e.g. org home), avoids a second round of sidebar queries. */
  data?: FeedSidebarData;
}

export async function FeedSidebar({ orgSlug, orgId, role, status, userId, data: preloaded }: FeedSidebarProps) {
  const data = preloaded ?? (await loadFeedSidebarData({ orgId, role, status, userId }));
  return <FeedSidebarWidgets orgSlug={orgSlug} data={data} />;
}
