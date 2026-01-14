"use client";

import { useState, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui";

interface ScheduleFileUploadProps {
  orgId: string;
  onUploadComplete?: () => void;
}

export function ScheduleFileUpload({ orgId, onUploadComplete }: ScheduleFileUploadProps) {
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate file type
    const allowedTypes = ["application/pdf", "image/png", "image/jpeg", "image/jpg"];
    if (!allowedTypes.includes(file.type)) {
      setError("Please upload a PDF or image file");
      return;
    }

    // Validate file size (10MB max)
    if (file.size > 10 * 1024 * 1024) {
      setError("File size must be under 10MB");
      return;
    }

    setIsUploading(true);
    setError(null);

    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      setError("You must be logged in to upload files");
      setIsUploading(false);
      return;
    }

    // Upload to storage: {user_id}/{timestamp}_{filename}
    const timestamp = Date.now();
    const filePath = `${user.id}/${timestamp}_${file.name}`;

    const { error: uploadError } = await supabase.storage
      .from("schedule-files")
      .upload(filePath, file);

    if (uploadError) {
      setError(uploadError.message);
      setIsUploading(false);
      return;
    }

    // Record in database
    const { error: dbError } = await supabase.from("schedule_files").insert({
      organization_id: orgId,
      user_id: user.id,
      file_name: file.name,
      file_path: filePath,
      file_size: file.size,
      mime_type: file.type,
    });

    if (dbError) {
      setError(dbError.message);
      setIsUploading(false);
      return;
    }

    setIsUploading(false);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
    onUploadComplete?.();
  };

  return (
    <div className="space-y-2">
      <input
        ref={fileInputRef}
        type="file"
        accept=".pdf,image/*"
        onChange={handleFileChange}
        className="hidden"
        id="schedule-file-input"
      />
      <label htmlFor="schedule-file-input">
        <Button
          type="button"
          variant="secondary"
          isLoading={isUploading}
          onClick={() => fileInputRef.current?.click()}
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
          </svg>
          Upload Schedule PDF
        </Button>
      </label>
      {error && (
        <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
      )}
    </div>
  );
}
