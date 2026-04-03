"use client";

import { useTranslations } from "next-intl";
import { UserContent } from "@/components/i18n/UserContent";
import { Card, Badge, Button, EmptyState } from "@/components/ui";
import Link from "next/link";

type Job = {
  id: string;
  title: string;
  company: string;
  location: string | null;
  location_type: string | null;
  industry: string | null;
  experience_level: string | null;
  created_at: string;
  users?: {
    name: string;
  } | null;
};

interface JobListProps {
  jobs: Job[];
  orgSlug: string;
  pagination?: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
  filterParams?: string;
}

export function JobList({ jobs, orgSlug, pagination, filterParams }: JobListProps) {
  const tJobs = useTranslations("jobs");
  const tCommon = useTranslations("common");

  const EXPERIENCE_LABELS: Record<string, string> = {
    entry: tJobs("entryLevel"),
    mid: tJobs("midLevel"),
    senior: tJobs("senior"),
    lead: tJobs("lead"),
    executive: tJobs("executive"),
  };

  const LOCATION_LABELS: Record<string, string> = {
    remote: tCommon("remote"),
    hybrid: tCommon("hybrid"),
    onsite: tCommon("onsite"),
  };

  if (jobs.length === 0) {
    return (
      <EmptyState
        title={tJobs("noJobs")}
        description={tJobs("noJobsDesc")}
      />
    );
  }

  const buildPageUrl = (page: number) => {
    const params = new URLSearchParams(filterParams || "");
    params.set("page", String(page));
    return `/${orgSlug}/jobs?${params.toString()}`;
  };

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {jobs.map((job) => (
          <Link
            key={job.id}
            href={`/${orgSlug}/jobs/${job.id}`}
            className="block transition-transform hover:scale-[1.02]"
          >
            <Card className="h-full p-4 hover:shadow-lg">
              <div className="space-y-3">
                <div>
                  <UserContent as="h3" className="font-semibold text-lg mb-1">
                    {job.title}
                  </UserContent>
                  <UserContent as="p" className="text-sm text-gray-600">
                    {job.company}
                  </UserContent>
                </div>

                <div className="flex flex-wrap gap-2">
                  {job.location && (
                    <Badge variant="muted">
                      <UserContent>{job.location}</UserContent>
                    </Badge>
                  )}
                  {job.location_type && (
                    <Badge variant="primary">
                      {LOCATION_LABELS[job.location_type] || job.location_type}
                    </Badge>
                  )}
                  {job.industry && (
                    <Badge variant="muted">
                      <UserContent>{job.industry}</UserContent>
                    </Badge>
                  )}
                  {job.experience_level && EXPERIENCE_LABELS[job.experience_level] && (
                    <Badge variant="primary">
                      {EXPERIENCE_LABELS[job.experience_level]}
                    </Badge>
                  )}
                </div>

                <div className="text-xs text-gray-500">
                  {job.users?.name
                    ? tJobs("postedBy", { date: new Date(job.created_at).toLocaleDateString(), name: job.users.name })
                    : tJobs("postedDate", { date: new Date(job.created_at).toLocaleDateString() })}
                </div>
              </div>
            </Card>
          </Link>
        ))}
      </div>
      {pagination && pagination.totalPages > 1 && (
        <div className="flex justify-center gap-2 pt-4">
          {pagination.page > 1 && (
            <Link href={buildPageUrl(pagination.page - 1)}>
              <Button variant="ghost" size="sm">
                {tCommon("previous")}
              </Button>
            </Link>
          )}
          <span className="text-sm text-muted-foreground self-center">
            {tCommon("page", { page: pagination.page, totalPages: pagination.totalPages })}
          </span>
          {pagination.page < pagination.totalPages && (
            <Link href={buildPageUrl(pagination.page + 1)}>
              <Button variant="ghost" size="sm">
                {tCommon("next")}
              </Button>
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
