"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, Button, Badge } from "@/components/ui";

const EXPERIENCE_LABELS: Record<string, string> = {
  entry: "Entry Level",
  mid: "Mid Level",
  senior: "Senior",
  lead: "Lead",
  executive: "Executive",
};

type Job = {
  id: string;
  title: string;
  company: string;
  location: string | null;
  location_type: string | null;
  industry: string | null;
  experience_level: string | null;
  description: string;
  application_url: string | null;
  contact_email: string | null;
  created_at: string;
  expires_at: string | null;
  users?: {
    name: string;
    email: string;
  } | null;
};

interface JobDetailProps {
  job: Job;
  orgSlug: string;
  canEdit: boolean;
}

export function JobDetail({ job, orgSlug, canEdit }: JobDetailProps) {
  const router = useRouter();
  const [isDeleting, setIsDeleting] = useState(false);

  const handleDelete = async () => {
    if (!confirm("Are you sure you want to delete this job posting?")) {
      return;
    }

    setIsDeleting(true);
    try {
      const response = await fetch(`/api/jobs/${job.id}`, {
        method: "DELETE",
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Failed to delete job");
      }

      router.replace(`/${orgSlug}/jobs`);
      router.refresh();
    } catch (error) {
      alert(error instanceof Error ? error.message : "Failed to delete job");
      setIsDeleting(false);
    }
  };

  const isExpired = job.expires_at && new Date(job.expires_at) < new Date();

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div>
        <Button onClick={() => router.push(`/${orgSlug}/jobs`)}>
          ← Back to Jobs
        </Button>
      </div>

      <Card className="p-6">
        <div className="space-y-6">
          <div>
            <div className="flex items-start justify-between mb-4">
              <div>
                <h1 className="text-3xl font-bold mb-2">{job.title}</h1>
                <p className="text-xl text-gray-600">{job.company}</p>
              </div>
              {canEdit && (
                <div className="flex gap-2">
                  <Button
                    onClick={() => router.push(`/${orgSlug}/jobs/${job.id}/edit`)}
                    disabled={isDeleting}
                  >
                    Edit
                  </Button>
                  <Button
                    onClick={handleDelete}
                    disabled={isDeleting}
                  >
                    {isDeleting ? "Deleting..." : "Delete"}
                  </Button>
                </div>
              )}
            </div>

            <div className="flex flex-wrap gap-2 mb-4">
              {job.location && (
                <Badge variant="muted">
                  {job.location}
                </Badge>
              )}
              {job.location_type && (
                <Badge variant="primary">
                  {job.location_type === "remote"
                    ? "Remote"
                    : job.location_type === "hybrid"
                    ? "Hybrid"
                    : "Onsite"}
                </Badge>
              )}
              {job.industry && (
                <Badge variant="muted">{job.industry}</Badge>
              )}
              {job.experience_level && EXPERIENCE_LABELS[job.experience_level] && (
                <Badge variant="primary">
                  {EXPERIENCE_LABELS[job.experience_level]}
                </Badge>
              )}
              {isExpired && (
                <Badge variant="error">Expired</Badge>
              )}
            </div>

            <div className="text-sm text-gray-600 space-y-1">
              <p>
                Posted {new Date(job.created_at).toLocaleDateString()}
                {job.users?.name && ` by ${job.users.name}`}
              </p>
              {job.expires_at && (
                <p>
                  Expires {new Date(job.expires_at).toLocaleDateString()}
                </p>
              )}
            </div>
          </div>

          <div className="border-t pt-6">
            <h2 className="text-xl font-semibold mb-3">Description</h2>
            <div className="prose max-w-none whitespace-pre-wrap">
              {job.description}
            </div>
          </div>

          {(job.application_url || job.contact_email) && (
            <div className="border-t pt-6">
              <h2 className="text-xl font-semibold mb-3">How to Apply</h2>
              <div className="space-y-2">
                {job.application_url && (
                  <div>
                    <a
                      href={job.application_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-2 text-blue-600 hover:text-blue-800 hover:underline"
                    >
                      Apply Online →
                    </a>
                  </div>
                )}
                {job.contact_email && (
                  <div>
                    <a
                      href={`mailto:${job.contact_email}`}
                      className="text-blue-600 hover:text-blue-800 hover:underline"
                    >
                      {job.contact_email}
                    </a>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}
