"use client";

import { Button } from "@/components/ui";
import type { Form, FormSubmission, FormField, User } from "@/types/database";

interface ExportCSVButtonProps {
  form: Form;
  submissions: (FormSubmission & { users: Pick<User, "name" | "email"> | null })[];
}

export function ExportCSVButton({ form, submissions }: ExportCSVButtonProps) {
  const handleExport = () => {
    const fields = (form.fields || []) as FormField[];
    
    // Build CSV headers
    const headers = ["Submitted By", "Email", "Date", ...fields.map((f) => f.label)];
    
    // Build rows
    const rows = submissions.map((sub) => {
      const responses = (sub.data || {}) as Record<string, unknown>;
      return [
        sub.users?.name || "",
        sub.users?.email || "",
        sub.submitted_at ? new Date(sub.submitted_at).toLocaleDateString() : "",
        ...fields.map((f) => formatValue(responses[f.name])),
      ];
    });

    // Create CSV content
    const csvContent = [
      headers.map(escapeCSV).join(","),
      ...rows.map((row) => row.map(escapeCSV).join(",")),
    ].join("\n");

    // Download
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${form.title.replace(/[^a-z0-9]/gi, "_")}_submissions.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Button variant="secondary" onClick={handleExport} disabled={submissions.length === 0}>
      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
      </svg>
      Export CSV
    </Button>
  );
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) return value.join("; ");
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return String(value);
}

function escapeCSV(value: string): string {
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}
