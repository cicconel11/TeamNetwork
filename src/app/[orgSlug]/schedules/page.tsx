import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/layout";
import { Card, Badge, Button, EmptyState } from "@/components/ui";
import { getOrgContext } from "@/lib/auth/roles";
import { AvailabilityGrid } from "@/components/schedules/AvailabilityGrid";
import { CalendarSyncPanel } from "@/components/schedules/CalendarSyncPanel";
import { resolveLabel, resolveActionLabel } from "@/lib/navigation/label-resolver";
import type { NavConfig } from "@/lib/navigation/nav-items";
import type { AcademicSchedule, User } from "@/types/database";

interface SchedulesPageProps {
  params: Promise<{ orgSlug: string }>;
}

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function formatOccurrence(schedule: AcademicSchedule): string {
  switch (schedule.occurrence_type) {
    case "single":
      return new Date(schedule.start_date).toLocaleDateString();
    case "daily":
      return "Daily";
    case "weekly":
      if (schedule.day_of_week && schedule.day_of_week.length > 0) {
        const labels = schedule.day_of_week.map((day) => DAYS[day]).join(", ");
        return `Every ${labels}`;
      }
      return "Weekly";
    case "monthly":
      return schedule.day_of_month ? `Monthly on the ${schedule.day_of_month}${getOrdinalSuffix(schedule.day_of_month)}` : "Monthly";
    default:
      return schedule.occurrence_type;
  }
}

function getOrdinalSuffix(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return s[(v - 20) % 10] || s[v] || s[0];
}

function formatTime(time: string): string {
  const [hours, minutes] = time.split(":");
  const h = parseInt(hours, 10);
  const ampm = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 || 12;
  return `${h12}:${minutes} ${ampm}`;
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

      <CalendarSyncPanel />

      {/* My Schedules Section */}
      <section>
        <h2 className="text-lg font-semibold text-foreground mb-4">My {pageLabel}</h2>
        {mySchedules && mySchedules.length > 0 ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {mySchedules.map((schedule) => (
              <Card key={schedule.id} className="p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <h3 className="font-medium text-foreground truncate">{schedule.title}</h3>
                    <p className="text-sm text-muted-foreground mt-1">
                      {formatTime(schedule.start_time)} - {formatTime(schedule.end_time)}
                    </p>
                    <div className="flex items-center gap-2 mt-2">
                      <Badge variant="muted">{formatOccurrence(schedule)}</Badge>
                    </div>
                    {schedule.notes && (
                      <p className="text-sm text-muted-foreground mt-2 line-clamp-2">{schedule.notes}</p>
                    )}
                  </div>
                  <Link href={`/${orgSlug}/schedules/${schedule.id}/edit`}>
                    <Button variant="ghost" size="sm">Edit</Button>
                  </Link>
                </div>
              </Card>
            ))}
          </div>
        ) : (
          <Card>
            <EmptyState
              title={`No ${pageLabel.toLowerCase()} yet`}
              description={`Add your class ${pageLabel.toLowerCase()} so coaches can plan around your availability.`}
              action={
                <Link href={`/${orgSlug}/schedules/new`}>
                  <Button>{resolveActionLabel("/schedules", navConfig, "Add First")}</Button>
                </Link>
              }
            />
          </Card>
        )}
      </section>

      {/* Team Availability Section (Admin Only) */}
      {orgCtx.isAdmin && (
        <section>
          <h2 className="text-lg font-semibold text-foreground mb-4">Team Availability</h2>
          <Card className="p-6">
            <AvailabilityGrid schedules={allSchedules} orgId={orgId} />
          </Card>
        </section>
      )}
    </div>
  );
}
