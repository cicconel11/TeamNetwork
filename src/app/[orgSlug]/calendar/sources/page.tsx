import Link from "next/link";
import { notFound } from "next/navigation";
import { getOrgContext } from "@/lib/auth/roles";
import { PageHeader } from "@/components/layout";
import { Button } from "@/components/ui";
import { TeamScheduleTab } from "@/components/schedules/tabs";
import { ScheduleDomainApprovalsPanel } from "@/components/schedules/ScheduleDomainApprovalsPanel";

interface SourcesPageProps {
  params: Promise<{ orgSlug: string }>;
}

export default async function CalendarSourcesPage({ params }: SourcesPageProps) {
  const { orgSlug } = await params;
  const orgCtx = await getOrgContext(orgSlug);

  if (!orgCtx.organization || !orgCtx.userId || !orgCtx.isAdmin) {
    notFound();
  }

  const orgId = orgCtx.organization.id;

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title="Manage Sources"
        description="Import and manage team schedule sources"
        actions={
          <Link href={`/${orgSlug}/calendar`}>
            <Button variant="secondary">
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18" />
              </svg>
              <span className="sr-only">Back to </span>Calendar
            </Button>
          </Link>
        }
      />

      <TeamScheduleTab
        orgId={orgId}
        orgSlug={orgSlug}
        isAdmin={orgCtx.isAdmin}
        isReadOnly={orgCtx.gracePeriod.isReadOnly}
      />

      <ScheduleDomainApprovalsPanel orgId={orgId} isAdmin={orgCtx.isAdmin} />
    </div>
  );
}
