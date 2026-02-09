import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/layout";
import { Button } from "@/components/ui";
import { getOrgContext } from "@/lib/auth/roles";
import { ScheduleDomainApprovalsPanel } from "@/components/schedules/ScheduleDomainApprovalsPanel";
import { SchedulesTabs } from "@/components/schedules/tabs";
import { resolveLabel, resolveActionLabel } from "@/lib/navigation/label-resolver";
import type { NavConfig } from "@/lib/navigation/nav-items";
import type { AcademicSchedule, User } from "@/types/database";

interface SchedulesPageProps {
  params: Promise<{ orgSlug: string }>;
}

export default async function SchedulesPage({ params }: SchedulesPageProps) {
  const { orgSlug } = await params;

  const orgCtx = await getOrgContext(orgSlug);
  const supabase = await createClient();

  if (!orgCtx.organization || !orgCtx.userId) return null;

  const orgId = orgCtx.organization.id;

  // Fetch user's own schedules
  const { data: mySchedules } = await supabase
    .from("academic_schedules")
    .select("*")
    .eq("organization_id", orgId)
    .eq("user_id", orgCtx.userId)
    .is("deleted_at", null)
    .order("start_time", { ascending: true });

  // For admins, fetch all schedules and files with user info
  let allSchedules: (AcademicSchedule & { users: Pick<User, "name" | "email"> | null })[] = [];
  if (orgCtx.isAdmin) {
    const { data } = await supabase
      .from("academic_schedules")
      .select("*, users(name, email)")
      .eq("organization_id", orgId)
      .is("deleted_at", null)
      .order("start_time", { ascending: true });
    allSchedules = (data || []) as (AcademicSchedule & { users: Pick<User, "name" | "email"> | null })[];
  }

  const navConfig = orgCtx.organization.nav_config as NavConfig | null;
  const pageLabel = resolveLabel("/schedules", navConfig);
  const actionLabel = resolveActionLabel("/schedules", navConfig);

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title={pageLabel}
        description={`Manage your class ${pageLabel.toLowerCase()} and academic commitments`}
        actions={
          <Link href={`/${orgSlug}/schedules/new`}>
            <Button>
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
              </svg>
              {actionLabel}
            </Button>
          </Link>
        }
      />

      <SchedulesTabs
        orgId={orgId}
        orgSlug={orgSlug}
        orgName={orgCtx.organization.name}
        isAdmin={orgCtx.isAdmin}
        mySchedules={mySchedules || []}
        allSchedules={allSchedules}
        navConfig={navConfig}
        pageLabel={pageLabel}
      />

      <ScheduleDomainApprovalsPanel orgId={orgId} isAdmin={orgCtx.isAdmin} />
    </div>
  );
}
