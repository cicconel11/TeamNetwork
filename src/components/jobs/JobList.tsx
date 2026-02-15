"use client";

import { Card } from "@/components/ui";
import { Badge } from "@/components/ui";
import { Button } from "@/components/ui";
import { EmptyState } from "@/components/ui";
import Link from "next/link";

type Job = {
  id: string;
  title: string;
  company: string;
  location: string | null;
  location_type: string | null;
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
}

export function JobList({ jobs, orgSlug, pagination }: JobListProps) {
  if (jobs.length === 0) {
    return (
      <EmptyState
        title="No jobs posted yet"
        description="Check back later for career opportunities shared by the community."
      />
    );
  }

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
                  <h3 className="font-semibold text-lg mb-1">{job.title}</h3>
                  <p className="text-sm text-gray-600">{job.company}</p>
                </div>

                <div className="flex flex-wrap gap-2">
                  {job.location && <Badge variant="muted">{job.location}</Badge>}
                  {job.location_type && (
                    <Badge variant="primary">
                      {job.location_type === "remote"
                        ? "Remote"
                        : job.location_type === "hybrid"
                          ? "Hybrid"
                          : "Onsite"}
                    </Badge>
                  )}
                </div>

                <div className="text-xs text-gray-500">
                  Posted {new Date(job.created_at).toLocaleDateString()}
                  {job.users?.name && ` by ${job.users.name}`}
                </div>
              </div>
            </Card>
          </Link>
        ))}
      </div>
      {pagination && pagination.totalPages > 1 && (
        <div className="flex justify-center gap-2 pt-4">
          {pagination.page > 1 && (
            <Link href={`/${orgSlug}/jobs?page=${pagination.page - 1}`}>
              <Button variant="ghost" size="sm">
                Previous
              </Button>
            </Link>
          )}
          <span className="text-sm text-muted-foreground self-center">
            Page {pagination.page} of {pagination.totalPages}
          </span>
          {pagination.page < pagination.totalPages && (
            <Link href={`/${orgSlug}/jobs?page=${pagination.page + 1}`}>
              <Button variant="ghost" size="sm">
                Next
              </Button>
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
