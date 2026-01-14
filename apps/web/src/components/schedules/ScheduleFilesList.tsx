"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui";
import type { ScheduleFile, User } from "@/types/database";

interface ScheduleFilesListProps {
  files: (ScheduleFile & { users?: Pick<User, "name" | "email"> | null })[];
  isAdmin?: boolean;
  onDelete?: () => void;
}

export function ScheduleFilesList({ files, isAdmin, onDelete }: ScheduleFilesListProps) {
  const [loadingId, setLoadingId] = useState<string | null>(null);

  const handleView = async (file: ScheduleFile) => {
    setLoadingId(file.id);
    const supabase = createClient();
    
    const { data, error } = await supabase.storage
      .from("schedule-files")
      .createSignedUrl(file.file_path, 60 * 5); // 5 min expiry

    if (error || !data?.signedUrl) {
      alert("Failed to get file URL");
      setLoadingId(null);
      return;
    }

    window.open(data.signedUrl, "_blank");
    setLoadingId(null);
  };

  const handleDelete = async (file: ScheduleFile) => {
    if (!confirm("Delete this file?")) return;
    
    setLoadingId(file.id);
    const supabase = createClient();

    // Delete from storage first
    const { error: storageError } = await supabase.storage
      .from("schedule-files")
      .remove([file.file_path]);

    if (storageError) {
      console.error("Storage delete error:", storageError);
      // Continue with DB delete even if storage fails
    }

    // Hard delete from DB (or soft delete if you prefer)
    const { error: dbError } = await supabase
      .from("schedule_files")
      .delete()
      .eq("id", file.id);

    if (dbError) {
      alert("Failed to delete file");
      setLoadingId(null);
      return;
    }

    setLoadingId(null);
    onDelete?.();
  };

  const formatFileSize = (bytes: number | null) => {
    if (!bytes) return "";
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  if (files.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">No files uploaded yet.</p>
    );
  }

  return (
    <ul className="space-y-2">
      {files.map((file) => (
        <li
          key={file.id}
          className="flex items-center justify-between gap-3 p-3 rounded-xl bg-muted/50 border border-border"
        >
          <div className="flex items-center gap-3 min-w-0">
            <div className="flex-shrink-0">
              {file.mime_type?.startsWith("image/") ? (
                <svg className="h-5 w-5 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="m2.25 15.75 5.159-5.159a2.25 2.25 0 0 1 3.182 0l5.159 5.159m-1.5-1.5 1.409-1.409a2.25 2.25 0 0 1 3.182 0l2.909 2.909m-18 3.75h16.5a1.5 1.5 0 0 0 1.5-1.5V6a1.5 1.5 0 0 0-1.5-1.5H3.75A1.5 1.5 0 0 0 2.25 6v12a1.5 1.5 0 0 0 1.5 1.5Zm10.5-11.25h.008v.008h-.008V8.25Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Z" />
                </svg>
              ) : (
                <svg className="h-5 w-5 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
                </svg>
              )}
            </div>
            <div className="min-w-0">
              <p className="text-sm font-medium text-foreground truncate">{file.file_name}</p>
              <p className="text-xs text-muted-foreground">
                {formatFileSize(file.file_size)}
                {isAdmin && file.users && (
                  <span> • {file.users.name || file.users.email}</span>
                )}
                {file.created_at && (
                  <span> • {new Date(file.created_at).toLocaleDateString()}</span>
                )}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => handleView(file)}
              isLoading={loadingId === file.id}
            >
              View
            </Button>
            {!isAdmin && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => handleDelete(file)}
                className="text-red-600 hover:text-red-700"
              >
                Delete
              </Button>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}
