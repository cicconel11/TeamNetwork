import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getOrgContext } from "@/lib/auth/roles";
import { PageHeader } from "@/components/layout";
import { Button } from "@/components/ui";
import { MyCalendarTab } from "@/components/schedules/tabs";
import { resolveLabel } from "@/lib/navigation/label-resolver";
import type { NavConfig } from "@/lib/navigation/nav-items";

interface MySettingsPageProps {
  params: Promise<{ orgSlug: string }>;
}

export default async function CalendarMySettingsPage({ params }: MySettingsPageProps) {
  const { orgSlug } = await params;
  const orgCtx = await getOrgContext(orgSlug);
  const supabase = await createClient();

  if (!orgCtx.organization || !orgCtx.userId) return null;

  const orgId = orgCtx.organization.id;

  const { data: mySchedules } = await supabase
    .from("academic_schedules")
    .select("*")
    .eq("organization_id", orgId)
    .eq("user_id", orgCtx.userId)
    .is("deleted_at", null)
    .order("start_time", { ascending: true });

  const navConfig = orgCtx.organization.nav_config as NavConfig | null;
  const pageLabel = resolveLabel("/calendar", navConfig);

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title="Sync Settings"
        description="Manage your personal calendar connections and schedules"
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

      <MyCalendarTab
        orgId={orgId}
        orgSlug={orgSlug}
        orgName={orgCtx.organization.name}
        mySchedules={mySchedules || []}
        navConfig={navConfig}
        pageLabel={pageLabel}
      />
    </div>
  );
}
