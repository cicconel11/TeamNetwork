"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter, useParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Card, Button, Input, Textarea } from "@/components/ui";
import { PageHeader } from "@/components/layout";

export default function UploadDocumentPage() {
  const router = useRouter();
  const params = useParams();
  const orgSlug = params.orgSlug as string;

  const [orgId, setOrgId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const supabase = createClient();
    supabase
      .from("organizations")
      .select("id")
      .eq("slug", orgSlug)
      .maybeSingle()
      .then(({ data }) => {
        if (data) setOrgId(data.id);
      });
  }, [orgSlug]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (!selectedFile) return;

    // Validate file type
    const allowedTypes = ["application/pdf", "image/png", "image/jpeg", "image/jpg"];
    if (!allowedTypes.includes(selectedFile.type)) {
      setError("Please upload a PDF or image file");
      return;
    }

    // Validate file size (20MB max)
    if (selectedFile.size > 20 * 1024 * 1024) {
      setError("File size must be under 20MB");
      return;
    }

    setFile(selectedFile);
    setError(null);

    // Auto-fill title from filename if empty
    if (!title) {
      const nameWithoutExt = selectedFile.name.replace(/\.[^/.]+$/, "");
      setTitle(nameWithoutExt);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file || !orgId) return;

    setIsLoading(true);
    setError(null);

    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      setError("You must be logged in");
      setIsLoading(false);
      return;
    }

    // Upload file to storage
    const timestamp = Date.now();
    const filePath = `${orgId}/templates/${timestamp}_${file.name}`;

    const { error: uploadError } = await supabase.storage
      .from("form-documents")
      .upload(filePath, file);

    if (uploadError) {
      setError(uploadError.message);
      setIsLoading(false);
      return;
    }

    // Create database record
    const { error: dbError } = await supabase.from("form_documents").insert({
      organization_id: orgId,
      title,
      description: description || null,
      file_name: file.name,
      file_path: filePath,
      file_size: file.size,
      mime_type: file.type,
      is_active: true,
      created_by: user.id,
    });

    if (dbError) {
      setError(dbError.message);
      setIsLoading(false);
      return;
    }

    router.push(`/${orgSlug}/forms/admin/documents`);
    router.refresh();
  };

  return (
    <div className="animate-fade-in">
      <PageHeader
        title="Upload Document Form"
        description="Upload a PDF form for members to download and fill out"
        backHref={`/${orgSlug}/forms/admin/documents`}
      />

      <Card className="max-w-2xl">
        <form onSubmit={handleSubmit} className="p-6 space-y-6">
          {error && (
            <div className="p-3 rounded-xl bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 text-sm">
              {error}
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-foreground mb-2">
              Document File
            </label>
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,image/*"
              onChange={handleFileChange}
              className="hidden"
            />
            <div
              onClick={() => fileInputRef.current?.click()}
              className="border-2 border-dashed border-border rounded-xl p-8 text-center cursor-pointer hover:border-org-primary transition-colors"
            >
              {file ? (
                <div className="space-y-2">
                  <svg className="h-10 w-10 mx-auto text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <p className="text-foreground font-medium">{file.name}</p>
                  <p className="text-sm text-muted-foreground">
                    {(file.size / 1024 / 1024).toFixed(2)} MB
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  <svg className="h-10 w-10 mx-auto text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
                  </svg>
                  <p className="text-muted-foreground">Click to select a PDF or image file</p>
                  <p className="text-xs text-muted-foreground">Max 20MB</p>
                </div>
              )}
            </div>
          </div>

          <Input
            label="Title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g., Liability Waiver, Medical Form"
            required
          />

          <Textarea
            label="Description (optional)"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Brief description of what this form is for..."
            rows={2}
          />

          <div className="flex justify-end gap-3 pt-4 border-t border-border">
            <Button type="button" variant="secondary" onClick={() => router.back()}>
              Cancel
            </Button>
            <Button type="submit" isLoading={isLoading} disabled={!file}>
              Upload Document
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
