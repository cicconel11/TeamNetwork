"use client";

import { Card } from "@/components/ui";
import { AvailabilityGrid } from "../AvailabilityGrid";
import type { AcademicSchedule, User } from "@teammeet/types";

type AvailabilityTabProps = {
  orgId: string;
  isAdmin: boolean;
  mySchedules: AcademicSchedule[];
  allSchedules: (AcademicSchedule & { users: Pick<User, "name" | "email"> | null })[];
};

function UserIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.501 20.118a7.5 7.5 0 0 1 14.998 0A17.933 17.933 0 0 1 12 21.75c-2.676 0-5.216-.584-7.499-1.632Z" />
    </svg>
  );
}

function UsersIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 0 0 2.625.372 9.337 9.337 0 0 0 4.121-.952 4.125 4.125 0 0 0-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 0 1 8.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0 1 11.964-3.07M12 6.375a3.375 3.375 0 1 1-6.75 0 3.375 3.375 0 0 1 6.75 0Zm8.25 2.25a2.625 2.625 0 1 1-5.25 0 2.625 2.625 0 0 1 5.25 0Z" />
    </svg>
  );
}

export function AvailabilityTab({
  orgId,
  isAdmin,
  mySchedules,
  allSchedules,
}: AvailabilityTabProps) {
  return (
    <div className="space-y-6">
      <section>
        <div className="flex items-center gap-2 mb-4">
          <UserIcon className="w-5 h-5 text-org-secondary" />
          <h2 className="text-lg font-display font-semibold text-foreground">My Availability</h2>
        </div>
        <Card className="p-6">
          <AvailabilityGrid schedules={mySchedules || []} orgId={orgId} mode="personal" />
        </Card>
      </section>

      {isAdmin && (
        <section>
          <div className="flex items-center gap-2 mb-4">
            <UsersIcon className="w-5 h-5 text-org-secondary" />
            <h2 className="text-lg font-display font-semibold text-foreground">Team Availability</h2>
          </div>
          <Card className="p-6">
            <AvailabilityGrid schedules={allSchedules} orgId={orgId} mode="team" />
          </Card>
        </section>
      )}
    </div>
  );
}
