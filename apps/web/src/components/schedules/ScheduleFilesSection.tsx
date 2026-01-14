"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui";
import { ScheduleFileUpload } from "./ScheduleFileUpload";
import { ScheduleFilesList } from "./ScheduleFilesList";
import type { ScheduleFile, User } from "@/types/database";

interface ScheduleFilesSectionProps {
  orgId: string;
  myFiles: ScheduleFile[];
  allFiles: (ScheduleFile & { users?: Pick<User, "name" | "email"> | null })[];
  isAdmin: boolean;
}

export function ScheduleFilesSection({
  orgId,
  myFiles,
  allFiles,
  isAdmin,
}: ScheduleFilesSectionProps) {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<"my" | "all">("my");

  const handleRefresh = () => {
    router.refresh();
  };

  return (
    <section>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-foreground">Uploaded Schedules</h2>
        <ScheduleFileUpload orgId={orgId} onUploadComplete={handleRefresh} />
      </div>

      {isAdmin && (
        <div className="flex gap-2 mb-4">
          <button
            onClick={() => setActiveTab("my")}
            className={`px-3 py-1.5 text-sm font-medium rounded-lg transition-colors ${
              activeTab === "my"
                ? "bg-org-primary text-white"
                : "bg-muted text-muted-foreground hover:text-foreground"
            }`}
          >
            My Files
          </button>
          <button
            onClick={() => setActiveTab("all")}
            className={`px-3 py-1.5 text-sm font-medium rounded-lg transition-colors ${
              activeTab === "all"
                ? "bg-org-primary text-white"
                : "bg-muted text-muted-foreground hover:text-foreground"
            }`}
          >
            All Team Files
          </button>
        </div>
      )}

      <Card className="p-4">
        {isAdmin && activeTab === "all" ? (
          <ScheduleFilesList files={allFiles} isAdmin onDelete={handleRefresh} />
        ) : (
          <ScheduleFilesList files={myFiles} onDelete={handleRefresh} />
        )}
      </Card>
    </section>
  );
}
