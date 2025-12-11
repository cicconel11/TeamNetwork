import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/layout";
import { Card, Badge, Button, EmptyState } from "@/components/ui";
import { getOrgContext } from "@/lib/auth/roles";
import { WorkoutLogEditor } from "@/components/workouts/WorkoutLogEditor";
import type { WorkoutLog } from "@/types/database";

interface WorkoutsPageProps {
  params: Promise<{ orgSlug: string }>;
}

export default async function WorkoutsPage({ params }: WorkoutsPageProps) {
  const { orgSlug } = await params;
  const orgCtx = await getOrgContext(orgSlug);
  const supabase = await createClient();

  if (!orgCtx.organization) return null;

  const orgId = orgCtx.organization.id;

  const { data: workouts } = await supabase
    .from("workouts")
    .select("*")
    .eq("organization_id", orgId)
    .order("workout_date", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false });

  const { data: userLogs } =
    orgCtx.userId && orgCtx.role
      ? await supabase
          .from("workout_logs")
          .select("*")
          .eq("organization_id", orgId)
          .eq("user_id", orgCtx.userId)
      : { data: [] };

  const userLogsList: WorkoutLog[] = (userLogs as WorkoutLog[]) || [];
  const logByWorkout = new Map<string, WorkoutLog>();
  userLogsList.forEach((log) => logByWorkout.set(log.workout_id, log));

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title="Workouts"
        description="View assigned workouts and track your progress"
        actions={
          orgCtx.isAdmin && (
            <Link href={`/${orgSlug}/workouts/new`}>
              <Button>
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                </svg>
                Post Workout
              </Button>
            </Link>
          )
        }
      />

      {workouts && workouts.length > 0 ? (
        <div className="space-y-4">
          {workouts.map((workout) => {
            const log = logByWorkout.get(workout.id);
            return (
              <Card key={workout.id} className="p-6 space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                  <div>
                    <h3 className="text-lg font-semibold text-foreground">{workout.title}</h3>
                    {workout.description && (
                      <p className="text-sm text-muted-foreground mt-1">{workout.description}</p>
                    )}
                    <div className="flex flex-wrap gap-3 mt-3 text-sm text-muted-foreground">
                      {workout.workout_date && (
                        <span className="flex items-center gap-1">
                          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5" />
                          </svg>
                          {new Date(workout.workout_date).toLocaleDateString()}
                        </span>
                      )}
                      {workout.external_url && (
                        <a
                          href={workout.external_url}
                          target="_blank"
                          rel="noreferrer"
                          className="flex items-center gap-1 text-org-primary hover:underline"
                        >
                          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6.75L21 3" />
                          </svg>
                          External workout
                        </a>
                      )}
                    </div>
                  </div>
                  {log && (
                    <Badge variant="muted" className="self-start">
                      {log.status.replace("_", " ")}
                    </Badge>
                  )}
                </div>

                {orgCtx.isActiveMember ? (
                  <WorkoutLogEditor
                    orgId={orgId}
                    workoutId={workout.id}
                    logId={log?.id}
                    initialStatus={(log?.status as "not_started" | "in_progress" | "completed") || "not_started"}
                    initialNotes={log?.notes || null}
                  />
                ) : (
                  <p className="text-sm text-muted-foreground">
                    {orgCtx.isAdmin
                      ? "Admins can post workouts and view member progress."
                      : "View-only access for alumni."}
                  </p>
                )}
              </Card>
            );
          })}
        </div>
      ) : (
        <Card>
          <EmptyState
            title="No workouts yet"
            description="Workouts will appear here once posted."
            action={
              orgCtx.isAdmin && (
                <Link href={`/${orgSlug}/workouts/new`}>
                  <Button>Post First Workout</Button>
                </Link>
              )
            }
          />
        </Card>
      )}
    </div>
  );
}

