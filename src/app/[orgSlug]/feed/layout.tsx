import { getOrgContext, getCurrentUser } from "@/lib/auth/roles";
import { canDevAdminPerform } from "@/lib/auth/dev-admin";
import { FeedSidebar } from "@/components/feed/FeedSidebar";

interface FeedLayoutProps {
  children: React.ReactNode;
  params: Promise<{ orgSlug: string }>;
}

export default async function FeedLayout({ children, params }: FeedLayoutProps) {
  const { orgSlug } = await params;
  const orgCtx = await getOrgContext(orgSlug);

  if (!orgCtx.organization) return null;

  const user = await getCurrentUser();
  const isDevAdmin = canDevAdminPerform(user, "view_org");

  return (
    <div className="container mx-auto px-4 py-6 max-w-6xl">
      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,640px)_300px] gap-8 xl:justify-center">
        <div className="w-full">
          {children}
        </div>
        <aside className="hidden xl:block animate-fade-in">
          <div className="sticky top-8 space-y-4">
            <FeedSidebar
              orgSlug={orgSlug}
              orgId={orgCtx.organization.id}
              role={orgCtx.role}
              status={orgCtx.status}
              userId={orgCtx.userId}
              isDevAdmin={isDevAdmin}
            />
          </div>
        </aside>
      </div>
    </div>
  );
}
