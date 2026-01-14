"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui";
import type { FormDocument } from "@/types/database";

interface DocumentActionsProps {
  document: FormDocument;
  orgSlug: string;
}

export function DocumentActions({ document, orgSlug }: DocumentActionsProps) {
  const router = useRouter();
  const [isDownloading, setIsDownloading] = useState(false);
  const [isToggling, setIsToggling] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const handleDownloadTemplate = async () => {
    setIsDownloading(true);
    const supabase = createClient();

    const { data, error } = await supabase.storage
      .from("form-documents")
      .createSignedUrl(document.file_path, 60 * 5);

    if (error || !data?.signedUrl) {
      alert("Failed to get file URL");
      setIsDownloading(false);
      return;
    }

    window.open(data.signedUrl, "_blank");
    setIsDownloading(false);
  };

  const handleToggleActive = async () => {
    setIsToggling(true);
    const supabase = createClient();

    await supabase
      .from("form_documents")
      .update({ is_active: !document.is_active, updated_at: new Date().toISOString() })
      .eq("id", document.id);

    router.refresh();
    setIsToggling(false);
  };

  const handleDelete = async () => {
    if (!confirm("Delete this document form? This will also delete all submissions.")) return;

    setIsDeleting(true);
    const supabase = createClient();

    await supabase
      .from("form_documents")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", document.id);

    router.push(`/${orgSlug}/forms/admin/documents`);
    router.refresh();
  };

  return (
    <div className="flex items-center gap-2">
      <Button variant="secondary" onClick={handleDownloadTemplate} isLoading={isDownloading}>
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
        </svg>
        Download Template
      </Button>
      <Button variant="secondary" onClick={handleToggleActive} isLoading={isToggling}>
        {document.is_active ? "Deactivate" : "Activate"}
      </Button>
      <Button
        variant="secondary"
        onClick={handleDelete}
        isLoading={isDeleting}
        className="text-red-600 hover:text-red-700"
      >
        Delete
      </Button>
    </div>
  );
}
