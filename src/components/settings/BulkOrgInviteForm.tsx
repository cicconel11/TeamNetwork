"use client";

import { useState, useRef } from "react";
import { useTranslations } from "next-intl";
import { Button, Card, Select, Input } from "@/components/ui";

interface BulkOrgInviteFormProps {
  orgId: string;
  onComplete: () => void;
  onCancel: () => void;
}

interface EmailResult {
  email: string;
  status: "sent" | "failed" | "skipped";
  error?: string;
}

interface BulkInviteResponse {
  emailsDelivered: boolean;
  invite: { id: string; code: string; token: string | null; link: string };
  summary: { success: number; failed: number; skipped: number; total: number };
  results: EmailResult[];
}

export function BulkOrgInviteForm({ orgId, onComplete, onCancel }: BulkOrgInviteFormProps) {
  const tInvites = useTranslations("invites");
  const tCommon = useTranslations("common");
  const tRoles = useTranslations("roles");

  const [emailText, setEmailText] = useState("");
  const [role, setRole] = useState<"active_member" | "admin" | "alumni" | "parent">("active_member");
  const [expiresAt, setExpiresAt] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [response, setResponse] = useState<BulkInviteResponse | null>(null);
  const [copied, setCopied] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const parseEmails = (text: string): string[] => {
    const seen = new Set<string>();

    return text
      .split(/[\n,;]+/)
      .map((e) => e.trim().toLowerCase())
      .filter((e) => {
        if (e.length === 0 || !e.includes("@") || seen.has(e)) return false;
        seen.add(e);
        return true;
      });
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      const lines = text.split("\n").filter((l) => l.trim());
      const firstLine = lines[0]?.toLowerCase() ?? "";
      const hasHeader = firstLine.includes("email");
      const dataLines = hasHeader ? lines.slice(1) : lines;

      const emails = dataLines
        .map((line) => line.split(",")[0]?.trim().replace(/^["']|["']$/g, ""))
        .filter((e) => e && e.includes("@"));

      setEmailText((prev) => {
        const existing = prev.trim();
        return existing ? `${existing}\n${emails.join("\n")}` : emails.join("\n");
      });
    };
    reader.readAsText(file);

    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const emails = parseEmails(emailText);

  const handleSubmit = async () => {
    if (emails.length === 0) {
      setError("Enter at least one email address");
      return;
    }

    if (emails.length > 100) {
      setError("Maximum 100 emails per batch");
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      const res = await fetch(`/api/organizations/${orgId}/invites/bulk`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          emails,
          role,
          expiresAt: expiresAt ? new Date(`${expiresAt}T23:59:59`).toISOString() : undefined,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to create bulk invites");
      }

      setResponse(data as BulkInviteResponse);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create invites");
    } finally {
      setIsSubmitting(false);
    }
  };

  const copyLink = (link: string) => {
    navigator.clipboard.writeText(link);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Show results after successful submission
  if (response) {
    const { summary, invite, emailsDelivered, results } = response;

    return (
      <Card className="p-6 mb-6">
        <h3 className="font-semibold text-foreground mb-4">Bulk Invite Results</h3>

        {!emailsDelivered && (
          <div className="mb-4 p-4 rounded-xl bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800">
            <p className="text-sm font-medium text-amber-700 dark:text-amber-300 mb-2">
              Email not configured — share this link directly
            </p>
            <div className="flex items-center gap-2">
              <code className="flex-1 text-sm bg-background px-3 py-2 rounded-lg border border-border truncate">
                {invite.link}
              </code>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => copyLink(invite.link)}
              >
                {copied ? tCommon("copied") : "Copy Link"}
              </Button>
            </div>
            <p className="text-xs text-amber-600 dark:text-amber-400 mt-2">
              Invite code: <span className="font-mono font-bold">{invite.code}</span> ({summary.total} uses)
            </p>
          </div>
        )}

        {emailsDelivered && (
          <div className={`mb-4 p-3 rounded-xl text-sm ${
            summary.failed > 0
              ? "bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-300"
              : "bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300"
          }`}>
            {summary.failed === 0
              ? `All ${summary.success} emails sent successfully.`
              : `${summary.success} sent, ${summary.failed} failed.`}
          </div>
        )}

        {emailsDelivered && results.length > 0 && (
          <div className="mb-4 max-h-48 overflow-y-auto border border-border rounded-lg">
            <table className="w-full text-sm">
              <thead className="bg-muted sticky top-0">
                <tr>
                  <th className="px-3 py-2 text-left text-muted-foreground">Email</th>
                  <th className="px-3 py-2 text-left text-muted-foreground">Status</th>
                </tr>
              </thead>
              <tbody>
                {results.map((r, idx) => (
                  <tr key={idx} className="border-t border-border">
                    <td className="px-3 py-2 truncate max-w-[200px]">{r.email}</td>
                    <td className="px-3 py-2">
                      <span className={`text-xs font-medium ${
                        r.status === "sent"
                          ? "text-emerald-600"
                          : r.status === "skipped"
                            ? "text-muted-foreground"
                            : "text-red-600"
                      }`}>
                        {r.status}
                      </span>
                      {r.error && (
                        <span className="text-xs text-muted-foreground ml-1">— {r.error}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="flex gap-3">
          <Button onClick={onComplete}>Done</Button>
        </div>
      </Card>
    );
  }

  return (
    <Card className="p-6 mb-6">
      <h3 className="font-semibold text-foreground mb-4">Bulk Invite</h3>

      <p className="text-sm text-muted-foreground mb-4">
        Enter email addresses (one per line, or comma/semicolon separated) or upload a CSV.
        A single invite code will be created with one use per email.
      </p>

      {error && (
        <div className="mb-4 p-3 rounded-xl bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 text-sm">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
        <Select
          label={tCommon("role")}
          value={role}
          onChange={(e) => setRole(e.target.value as typeof role)}
          options={[
            { value: "active_member", label: tRoles("activeMember") },
            { value: "admin", label: tRoles("admin") },
            { value: "alumni", label: tRoles("alumni") },
            { value: "parent", label: tRoles("parent") },
          ]}
        />
        <Input
          label={tInvites("expiresOn")}
          type="date"
          value={expiresAt}
          onChange={(e) => setExpiresAt(e.target.value)}
        />
        <div>
          <label className="block text-sm font-medium text-foreground mb-2">CSV File</label>
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,.txt"
            onChange={handleFileChange}
            className="block w-full text-sm text-muted-foreground file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-muted file:text-foreground hover:file:bg-muted/80"
          />
        </div>
      </div>

      <div className="mb-4">
        <label className="block text-sm font-medium text-foreground mb-2">
          Email Addresses ({emails.length})
        </label>
        <textarea
          value={emailText}
          onChange={(e) => setEmailText(e.target.value)}
          placeholder="jane@example.com&#10;john@example.com&#10;..."
          rows={6}
          className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
        />
        {emails.length > 100 && (
          <p className="text-xs text-red-600 mt-1">Maximum 100 emails per batch</p>
        )}
      </div>

      <div className="flex gap-3">
        <Button
          onClick={handleSubmit}
          isLoading={isSubmitting}
          disabled={emails.length === 0 || emails.length > 100}
        >
          Send {emails.length} Invites
        </Button>
        <Button variant="secondary" onClick={onCancel}>
          {tCommon("cancel")}
        </Button>
      </div>
    </Card>
  );
}
