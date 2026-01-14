"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Card, Button } from "@/components/ui";
import type { FormDocumentSubmission, User } from "@/types/database";

interface DocumentSubmissionsListProps {
  submissions: (FormDocumentSubmission & { users: Pick<User, "name" | "email"> | null })[];
}

export function DocumentSubmissionsList({ submissions }: DocumentSubmissionsListProps) {
  const [loadingId, setLoadingId] = useState<string | null>(null);

  const handleDownload = async (submission: FormDocumentSubmission) => {
    setLoadingId(submission.id);
    const supabase = createClient();

    const { data, error } = await supabase.storage
      .from("form-documents")
      .createSignedUrl(submission.file_path, 60 * 5);

    if (error || !data?.signedUrl) {
      alert("Failed to get file URL");
      setLoadingId(null);
      return;
    }

    window.open(data.signedUrl, "_blank");
    setLoadingId(null);
  };

  if (submissions.length === 0) {
    return (
      <Card className="p-8 text-center">
        <p className="text-muted-foreground">No submissions yet.</p>
      </Card>
    );
  }

  return (
    <Card className="overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 border-b border-border">
            <tr>
              <th className="text-left p-3 font-medium text-muted-foreground">Submitted By</th>
              <th className="text-left p-3 font-medium text-muted-foreground">File</th>
              <th className="text-left p-3 font-medium text-muted-foreground">Date</th>
              <th className="text-right p-3 font-medium text-muted-foreground">Actions</th>
            </tr>
          </thead>
          <tbody>
            {submissions.map((submission) => (
              <tr key={submission.id} className="border-b border-border last:border-0 hover:bg-muted/30">
                <td className="p-3 text-foreground">
                  {submission.users?.name || submission.users?.email || "Unknown"}
                </td>
                <td className="p-3 text-foreground">
                  <span className="truncate max-w-[200px] inline-block">{submission.file_name}</span>
                </td>
                <td className="p-3 text-muted-foreground">
                  {submission.submitted_at
                    ? new Date(submission.submitted_at).toLocaleDateString()
                    : "-"}
                </td>
                <td className="p-3 text-right">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => handleDownload(submission)}
                    isLoading={loadingId === submission.id}
                  >
                    Download
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
