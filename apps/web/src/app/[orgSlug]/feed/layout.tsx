import { getOrgContext } from "@/lib/auth/roles";
import { FeedSidebar } from "@/components/feed/FeedSidebar";

interface FeedLayoutProps {
  children: React.ReactNode;
  params: Promise<{ orgSlug: string }>;
}

export default async function FeedLayout({ children, params }: FeedLayoutProps) {
  const { orgSlug } = await params;
  const orgCtx = await getOrgContext(orgSlug);

  if (!orgCtx.organization || !orgCtx.role) return null;

  return (
    <div className="grid grid-cols-1 xl:grid-cols-[1fr_300px] gap-6">
        {children}
        <aside className="hidden xl:block animate-fade-in">
          <div className="sticky top-8 space-y-4">
            <FeedSidebar
              orgSlug={orgSlug}
              orgId={orgCtx.organization.id}
              role={orgCtx.role}
              status={orgCtx.status}
              userId={orgCtx.userId}
            />
          </div>
        </aside>
    </div>
  );
}
