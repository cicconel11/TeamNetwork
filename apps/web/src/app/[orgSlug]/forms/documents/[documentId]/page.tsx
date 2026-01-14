"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter, useParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Card, Button } from "@/components/ui";
import { PageHeader } from "@/components/layout";
import type { FormDocument, FormDocumentSubmission } from "@/types/database";

export default function DocumentSubmitPage() {
  const router = useRouter();
  const params = useParams();
  const orgSlug = params.orgSlug as string;
  const documentId = params.documentId as string;

  const [document, setDocument] = useState<FormDocument | null>(null);
  const [existingSubmission, setExistingSubmission] = useState<FormDocumentSubmission | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [isFetching, setIsFetching] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const load = async () => {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();

      // Fetch document
      const { data: docData } = await supabase
        .from("form_documents")
        .select("*")
        .eq("id", documentId)
        .eq("is_active", true)
        .is("deleted_at", null)
        .single();

      if (!docData) {
        router.push(`/${orgSlug}/forms/documents`);
        return;
      }

      setDocument(docData as FormDocument);

      // Check for existing submission
      if (user) {
        const { data: submission } = await supabase
          .from("form_document_submissions")
          .select("*")
          .eq("document_id", documentId)
          .eq("user_id", user.id)
          .order("submitted_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (submission) {
          setExistingSubmission(submission as FormDocumentSubmission);
        }
      }

      setIsFetching(false);
    };

    load();
  }, [documentId, orgSlug, router]);

  const handleDownloadTemplate = async () => {
    if (!document) return;
    setIsDownloading(true);
    
    const supabase = createClient();
    const { data, error } = await supabase.storage
      .from("form-documents")
      .createSignedUrl(document.file_path, 60 * 5);

    if (error || !data?.signedUrl) {
      alert("Failed to download file");
      setIsDownloading(false);
      return;
    }

    window.open(data.signedUrl, "_blank");
    setIsDownloading(false);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (!selectedFile) return;

    const allowedTypes = ["application/pdf", "image/png", "image/jpeg", "image/jpg"];
    if (!allowedTypes.includes(selectedFile.type)) {
      setError("Please upload a PDF or image file");
      return;
    }

    if (selectedFile.size > 20 * 1024 * 1024) {
      setError("File size must be under 20MB");
      return;
    }

    setFile(selectedFile);
    setError(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file || !document) return;

    setIsLoading(true);
    setError(null);

    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      setError("You must be logged in");
      setIsLoading(false);
      return;
    }

    // Upload file
    const timestamp = Date.now();
    const filePath = `${document.organization_id}/submissions/${user.id}/${timestamp}_${file.name}`;

    const { error: uploadError } = await supabase.storage
      .from("form-documents")
      .upload(filePath, file);

    if (uploadError) {
      setError(uploadError.message);
      setIsLoading(false);
      return;
    }

    // Create submission record
    const { error: dbError } = await supabase.from("form_document_submissions").insert({
      document_id: documentId,
      organization_id: document.organization_id,
      user_id: user.id,
      file_name: file.name,
      file_path: filePath,
      file_size: file.size,
      mime_type: file.type,
    });

    if (dbError) {
      setError(dbError.message);
      setIsLoading(false);
      return;
    }

    setSuccess(true);
    setIsLoading(false);
  };

  if (isFetching) {
    return (
      <div className="animate-fade-in">
        <PageHeader title="Loading..." backHref={`/${orgSlug}/forms/documents`} />
        <Card className="p-6">
          <p className="text-muted-foreground">Loading document...</p>
        </Card>
      </div>
    );
  }

  if (!document) return null;

  if (success) {
    return (
      <div className="animate-fade-in">
        <PageHeader title={document.title} backHref={`/${orgSlug}/forms/documents`} />
        <Card className="p-8 text-center max-w-xl mx-auto">
          <div className="text-green-500 mb-4">
            <svg className="h-16 w-16 mx-auto" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <h2 className="text-xl font-semibold text-foreground mb-2">Document Submitted!</h2>
          <p className="text-muted-foreground mb-6">Your completed form has been uploaded.</p>
          <Button onClick={() => router.push(`/${orgSlug}/forms/documents`)}>Back to Documents</Button>
        </Card>
      </div>
    );
  }

  return (
    <div className="animate-fade-in">
      <PageHeader
        title={document.title}
        description={document.description || undefined}
        backHref={`/${orgSlug}/forms/documents`}
      />

      <div className="max-w-2xl space-y-6">
        {/* Step 1: Download */}
        <Card className="p-6">
          <h2 className="text-lg font-semibold text-foreground mb-2">Step 1: Download the Form</h2>
          <p className="text-sm text-muted-foreground mb-4">
            Download the form template, print it, and fill it out.
          </p>
          <Button variant="secondary" onClick={handleDownloadTemplate} isLoading={isDownloading}>
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
            </svg>
            Download Form ({document.file_name})
          </Button>
        </Card>

        {/* Step 2: Upload */}
        <Card className="p-6">
          <h2 className="text-lg font-semibold text-foreground mb-2">Step 2: Upload Completed Form</h2>
          <p className="text-sm text-muted-foreground mb-4">
            Scan or photograph your completed form and upload it here.
          </p>

          {existingSubmission && (
            <div className="p-3 rounded-xl bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 text-sm mb-4">
              You submitted this form on {new Date(existingSubmission.submitted_at!).toLocaleDateString()}. 
              You can submit a new version below.
            </div>
          )}

          {error && (
            <div className="p-3 rounded-xl bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 text-sm mb-4">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,image/*"
              onChange={handleFileChange}
              className="hidden"
            />
            <div
              onClick={() => fileInputRef.current?.click()}
              className="border-2 border-dashed border-border rounded-xl p-6 text-center cursor-pointer hover:border-org-primary transition-colors"
            >
              {file ? (
                <div className="space-y-1">
                  <svg className="h-8 w-8 mx-auto text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <p className="text-foreground font-medium">{file.name}</p>
                  <p className="text-xs text-muted-foreground">{(file.size / 1024 / 1024).toFixed(2)} MB</p>
                </div>
              ) : (
                <div className="space-y-1">
                  <svg className="h-8 w-8 mx-auto text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
                  </svg>
                  <p className="text-muted-foreground">Click to select your completed form</p>
                  <p className="text-xs text-muted-foreground">PDF or image, max 20MB</p>
                </div>
              )}
            </div>

            <div className="flex justify-end">
              <Button type="submit" isLoading={isLoading} disabled={!file}>
                Submit Completed Form
              </Button>
            </div>
          </form>
        </Card>
      </div>
    </div>
  );
}
