"use client";

import { useState, useRef } from "react";
import { Button, Card, Select } from "@/components/ui";

interface Organization {
  id: string;
  name: string;
}

interface BulkInviteUploaderProps {
  enterpriseId: string;
  organizations: Organization[];
  onUploaded: () => void;
  onCancel: () => void;
}

interface ParsedRow {
  email?: string;
  role?: string;
  organizationId?: string;
}

export function BulkInviteUploader({
  enterpriseId,
  organizations,
  onUploaded,
  onCancel,
}: BulkInviteUploaderProps) {
  const [selectedOrg, setSelectedOrg] = useState<string>("");
  const [defaultRole, setDefaultRole] = useState<string>("active_member");
  const [file, setFile] = useState<File | null>(null);
  const [parsedRows, setParsedRows] = useState<ParsedRow[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<{ success: number; failed: number } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setFile(file);
    setError(null);
    setResults(null);

    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      const rows = parseCSV(text);
      setParsedRows(rows);
    };
    reader.onerror = () => {
      setError("Failed to read file");
    };
    reader.readAsText(file);
  };

  const parseCSV = (text: string): ParsedRow[] => {
    const lines = text.split("\n").filter((line) => line.trim());
    if (lines.length === 0) return [];

    // Check if first line is a header
    const firstLine = lines[0].toLowerCase();
    const hasHeader = firstLine.includes("email") || firstLine.includes("role");
    const dataLines = hasHeader ? lines.slice(1) : lines;

    return dataLines.map((line) => {
      const parts = line.split(",").map((p) => p.trim().replace(/^["']|["']$/g, ""));
      return {
        email: parts[0] || undefined,
        role: parts[1] || undefined,
        organizationId: parts[2] || undefined,
      };
    }).filter((row) => row.email);
  };

  const handleUpload = async () => {
    if (parsedRows.length === 0) {
      setError("No valid rows to upload");
      return;
    }

    if (!selectedOrg) {
      setError("Please select a default organization");
      return;
    }

    setIsUploading(true);
    setError(null);

    try {
      const invites = parsedRows.map((row) => ({
        organizationId: row.organizationId || selectedOrg,
        role: row.role || defaultRole,
        // Email is stored for tracking but invites are code-based
      }));

      const res = await fetch(`/api/enterprise/${enterpriseId}/invites/bulk`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ invites }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to create invites");
      }

      const data = await res.json();
      setResults(data);

      if (data.failed === 0) {
        onUploaded();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to upload invites");
    } finally {
      setIsUploading(false);
    }
  };

  const clearFile = () => {
    setFile(null);
    setParsedRows([]);
    setResults(null);
    setError(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const orgOptions = [
    { value: "", label: "Select default organization" },
    ...organizations.map((org) => ({ value: org.id, label: org.name })),
  ];

  const roleOptions = [
    { value: "active_member", label: "Active Member" },
    { value: "admin", label: "Admin" },
    { value: "alumni", label: "Alumni" },
  ];

  return (
    <Card className="p-6">
      <h3 className="font-semibold text-foreground mb-4">Bulk Import Invites</h3>

      <p className="text-sm text-muted-foreground mb-4">
        Upload a CSV file to create multiple invites at once. Each row creates one invite code.
        Format: <code className="bg-muted px-1 rounded">email,role,organization_id</code> (role and org are optional).
      </p>

      {error && (
        <div className="mb-4 p-3 rounded-xl bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 text-sm">
          {error}
        </div>
      )}

      {results && (
        <div className={`mb-4 p-3 rounded-xl text-sm ${
          results.failed > 0
            ? "bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-300"
            : "bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300"
        }`}>
          Created {results.success} invites. {results.failed > 0 && `${results.failed} failed.`}
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
        <Select
          label="Default Organization"
          value={selectedOrg}
          onChange={(e) => setSelectedOrg(e.target.value)}
          options={orgOptions}
        />
        <Select
          label="Default Role"
          value={defaultRole}
          onChange={(e) => setDefaultRole(e.target.value)}
          options={roleOptions}
        />
      </div>

      <div className="mb-4">
        <label className="block text-sm font-medium text-foreground mb-2">
          CSV File
        </label>
        <div className="flex items-center gap-3">
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,.txt"
            onChange={handleFileChange}
            className="block w-full text-sm text-muted-foreground
              file:mr-4 file:py-2 file:px-4
              file:rounded-lg file:border-0
              file:text-sm file:font-medium
              file:bg-purple-100 file:text-purple-700
              hover:file:bg-purple-200
              dark:file:bg-purple-900/30 dark:file:text-purple-300"
          />
          {file && (
            <Button variant="ghost" size="sm" onClick={clearFile}>
              Clear
            </Button>
          )}
        </div>
        {parsedRows.length > 0 && (
          <p className="text-sm text-muted-foreground mt-2">
            {parsedRows.length} rows found
          </p>
        )}
      </div>

      {parsedRows.length > 0 && (
        <div className="mb-4 max-h-40 overflow-y-auto border border-border rounded-lg">
          <table className="w-full text-sm">
            <thead className="bg-muted">
              <tr>
                <th className="px-3 py-2 text-left text-muted-foreground">#</th>
                <th className="px-3 py-2 text-left text-muted-foreground">Email</th>
                <th className="px-3 py-2 text-left text-muted-foreground">Role</th>
              </tr>
            </thead>
            <tbody>
              {parsedRows.slice(0, 10).map((row, idx) => (
                <tr key={idx} className="border-t border-border">
                  <td className="px-3 py-2 text-muted-foreground">{idx + 1}</td>
                  <td className="px-3 py-2">{row.email}</td>
                  <td className="px-3 py-2">{row.role || defaultRole}</td>
                </tr>
              ))}
              {parsedRows.length > 10 && (
                <tr className="border-t border-border">
                  <td colSpan={3} className="px-3 py-2 text-center text-muted-foreground">
                    ... and {parsedRows.length - 10} more
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      <div className="flex gap-3">
        <Button
          onClick={handleUpload}
          isLoading={isUploading}
          disabled={parsedRows.length === 0 || !selectedOrg}
        >
          Create {parsedRows.length} Invites
        </Button>
        <Button variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </Card>
  );
}
