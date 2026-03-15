"use client";

import { useSearchParams } from "next/navigation";
import { CalendarViewToggle } from "./CalendarViewToggle";
import { UnifiedEventFeed } from "./UnifiedEventFeed";
import { AvailabilityTab } from "@/components/schedules/tabs/AvailabilityTab";
import type { AcademicSchedule, User } from "@/types/database";

type CalendarContentProps = {
  orgId: string;
  orgSlug: string;
  isAdmin: boolean;
  mySchedules: AcademicSchedule[];
  allSchedules: (AcademicSchedule & { users: Pick<User, "name" | "email"> | null })[];
};

export function CalendarContent({
  orgId,
  orgSlug,
  isAdmin,
  mySchedules,
  allSchedules,
}: CalendarContentProps) {
  const searchParams = useSearchParams();
  const currentView = searchParams.get("view") === "availability" ? "availability" : "list";

  return (
    <div className="space-y-6">
      <CalendarViewToggle />

      <div className="animate-fade-in">
        {currentView === "list" ? (
          <UnifiedEventFeed orgId={orgId} orgSlug={orgSlug} />
        ) : (
          <AvailabilityTab
            orgId={orgId}
            isAdmin={isAdmin}
            mySchedules={mySchedules}
            allSchedules={allSchedules}
          />
        )}
      </div>
    </div>
  );
}
