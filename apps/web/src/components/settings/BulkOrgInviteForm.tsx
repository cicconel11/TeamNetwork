"use client";

import { useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Badge, Button, Card, Input, Select, Textarea } from "@/components/ui";

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

const MAX_EMAILS_PER_BATCH = 100;

function formatExpiryLabel(value: string) {
  if (!value) return "No expiration";
  const parsed = new Date(`${value}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
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
      .map((entry) => entry.trim().toLowerCase())
      .filter((entry) => {
        if (entry.length === 0 || !entry.includes("@") || seen.has(entry)) return false;
        seen.add(entry);
        return true;
      });
  };

  const emails = useMemo(() => parseEmails(emailText), [emailText]);
  const previewEmails = emails.slice(0, 6);
  const remainingPreviewCount = Math.max(0, emails.length - previewEmails.length);
  const selectedRoleLabel =
    role === "active_member"
      ? tRoles("activeMember")
      : role === "admin"
        ? tRoles("admin")
        : role === "alumni"
          ? tRoles("alumni")
          : tRoles("parent");

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      const lines = text.split("\n").filter((line) => line.trim());
      const firstLine = lines[0]?.toLowerCase() ?? "";
      const hasHeader = firstLine.includes("email");
      const dataLines = hasHeader ? lines.slice(1) : lines;

      const uploadedEmails = dataLines
        .map((line) => line.split(",")[0]?.trim().replace(/^["']|["']$/g, ""))
        .filter((entry) => entry && entry.includes("@"));

      setEmailText((prev) => {
        const existing = prev.trim();
        return existing ? `${existing}\n${uploadedEmails.join("\n")}` : uploadedEmails.join("\n");
      });
    };
    reader.readAsText(file);

    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleSubmit = async () => {
    if (emails.length === 0) {
      setError("Enter at least one email address");
      return;
    }

    if (emails.length > MAX_EMAILS_PER_BATCH) {
      setError(`Maximum ${MAX_EMAILS_PER_BATCH} emails per batch`);
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

  const copyLink = async (link: string) => {
    await navigator.clipboard.writeText(link);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (response) {
    const { summary, invite, emailsDelivered, results } = response;

    return (
      <Card className="mb-6 overflow-hidden border-border/80 bg-card/95 p-0 shadow-sm">
        <div className="border-b border-border/70 px-6 py-5">
          <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
            <div>
              <h3 className="text-lg font-semibold text-foreground">Bulk invite results</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                Review delivery outcomes and share the fallback invite link if email delivery is unavailable.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Badge variant="success">{summary.success} sent</Badge>
              {summary.failed > 0 && <Badge variant="warning">{summary.failed} failed</Badge>}
              {summary.skipped > 0 && <Badge variant="muted">{summary.skipped} skipped</Badge>}
            </div>
          </div>
        </div>

        <div className="grid gap-4 border-b border-border/70 px-6 py-5 sm:grid-cols-3">
          <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/8 p-4">
            <p className="text-xs font-medium uppercase tracking-[0.18em] text-emerald-600 dark:text-emerald-300">
              Delivered
            </p>
            <p className="mt-2 text-3xl font-semibold text-foreground">{summary.success}</p>
          </div>
          <div className="rounded-2xl border border-amber-500/20 bg-amber-500/8 p-4">
            <p className="text-xs font-medium uppercase tracking-[0.18em] text-amber-600 dark:text-amber-300">
              Failed
            </p>
            <p className="mt-2 text-3xl font-semibold text-foreground">{summary.failed}</p>
          </div>
          <div className="rounded-2xl border border-border bg-muted/30 p-4">
            <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
              Batch size
            </p>
            <p className="mt-2 text-3xl font-semibold text-foreground">{summary.total}</p>
          </div>
        </div>

        <div className="space-y-5 px-6 py-5">
          {!emailsDelivered && (
            <div className="rounded-2xl border border-amber-500/25 bg-amber-500/8 p-4">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <p className="text-sm font-medium text-amber-700 dark:text-amber-300">
                    Email delivery is not configured in this environment.
                  </p>
                  <p className="mt-1 text-sm text-amber-700/80 dark:text-amber-200/80">
                    Share the invite link directly with your recipients.
                  </p>
                </div>
                <Badge variant="warning">Fallback link required</Badge>
              </div>
              <div className="mt-4 flex flex-col gap-2 lg:flex-row lg:items-center">
                <code className="min-w-0 flex-1 overflow-hidden rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground">
                  <span className="block truncate">{invite.link}</span>
                </code>
                <Button variant="secondary" onClick={() => void copyLink(invite.link)}>
                  {copied ? tCommon("copied") : tInvites("copyLink")}
                </Button>
              </div>
              <p className="mt-3 text-xs text-amber-700/80 dark:text-amber-200/80">
                Invite code: <span className="font-mono font-semibold">{invite.code}</span>
              </p>
            </div>
          )}

          {emailsDelivered && (
            <div
              className={`rounded-2xl border p-4 text-sm ${
                summary.failed > 0
                  ? "border-amber-500/25 bg-amber-500/8 text-amber-700 dark:text-amber-300"
                  : "border-emerald-500/25 bg-emerald-500/8 text-emerald-700 dark:text-emerald-300"
              }`}
            >
              {summary.failed === 0
                ? `All ${summary.success} invites were sent successfully.`
                : `${summary.success} invites were sent. ${summary.failed} could not be delivered.`}
            </div>
          )}

          {results.length > 0 && (
            <div className="overflow-hidden rounded-2xl border border-border">
              <div className="flex items-center justify-between border-b border-border bg-muted/30 px-4 py-3">
                <h4 className="text-sm font-medium text-foreground">Recipient results</h4>
                <span className="text-xs text-muted-foreground">{results.length} rows</span>
              </div>
              <div className="max-h-72 overflow-y-auto">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-background/95 backdrop-blur">
                    <tr className="border-b border-border">
                      <th className="px-4 py-3 text-left font-medium text-muted-foreground">Email</th>
                      <th className="px-4 py-3 text-left font-medium text-muted-foreground">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {results.map((resultRow, idx) => (
                      <tr key={`${resultRow.email}-${idx}`} className="border-b border-border/70 last:border-b-0">
                        <td className="max-w-[260px] truncate px-4 py-3 text-foreground">{resultRow.email}</td>
                        <td className="px-4 py-3">
                          <div className="flex flex-wrap items-center gap-2">
                            <Badge
                              variant={
                                resultRow.status === "sent"
                                  ? "success"
                                  : resultRow.status === "failed"
                                    ? "error"
                                    : "muted"
                              }
                            >
                              {resultRow.status}
                            </Badge>
                            {resultRow.error && (
                              <span className="text-xs text-muted-foreground">{resultRow.error}</span>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        <div className="flex justify-end gap-3 border-t border-border/70 px-6 py-4">
          <Button variant="secondary" onClick={onCancel}>
            {tCommon("close")}
          </Button>
          <Button onClick={onComplete}>{tCommon("done")}</Button>
        </div>
      </Card>
    );
  }

  return (
    <Card className="mb-6 overflow-hidden border-border/80 bg-card/95 p-0 shadow-sm">
      <div className="border-b border-border/70 px-6 py-5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h3 className="text-lg font-semibold text-foreground">Bulk invite</h3>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
              Paste email addresses or upload a CSV to create one invite batch with a unique recipient list.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge variant="muted">Role: {selectedRoleLabel}</Badge>
            <Badge variant={emails.length > MAX_EMAILS_PER_BATCH ? "warning" : "primary"}>
              {emails.length}/{MAX_EMAILS_PER_BATCH} recipients
            </Badge>
            <Badge variant="muted">Expires: {formatExpiryLabel(expiresAt)}</Badge>
          </div>
        </div>
      </div>

      <div className="grid gap-6 px-6 py-5 xl:grid-cols-[minmax(0,1.65fr)_minmax(320px,0.95fr)]">
        <div className="space-y-5">
          {error && (
            <div className="rounded-2xl border border-red-500/20 bg-red-500/8 px-4 py-3 text-sm text-red-600 dark:text-red-400">
              {error}
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
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
            <div className="space-y-1.5">
              <label className="block text-sm font-medium text-foreground">Import file</label>
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,.txt"
                onChange={handleFileChange}
                className="hidden"
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="flex min-h-[42px] w-full items-center justify-between rounded-xl border border-dashed border-border bg-muted/25 px-4 py-3 text-left text-sm text-foreground transition hover:border-org-secondary/50 hover:bg-muted/40"
              >
                <span>
                  Upload CSV or TXT
                  <span className="mt-0.5 block text-xs text-muted-foreground">
                    First column should contain email addresses.
                  </span>
                </span>
                <svg className="h-4 w-4 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 16V4m0 0l-4 4m4-4l4 4M4 20h16" />
                </svg>
              </button>
            </div>
          </div>

          <Textarea
            label={`Email addresses (${emails.length})`}
            value={emailText}
            onChange={(e) => setEmailText(e.target.value)}
            placeholder="jane@example.com&#10;john@example.com&#10;coach@example.com"
            rows={10}
            helperText="Separate addresses with new lines, commas, or semicolons. Duplicate addresses are removed automatically."
            className="min-h-[220px]"
          />

          {emails.length > 0 && (
            <div className="rounded-2xl border border-border bg-muted/20 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h4 className="text-sm font-medium text-foreground">Recipient preview</h4>
                  <p className="mt-1 text-xs text-muted-foreground">
                    We detected {emails.length} unique email{emails.length === 1 ? "" : "s"} in this batch.
                  </p>
                </div>
                {emails.length > MAX_EMAILS_PER_BATCH && (
                  <Badge variant="warning">Trim to {MAX_EMAILS_PER_BATCH} or fewer recipients</Badge>
                )}
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {previewEmails.map((email) => (
                  <span
                    key={email}
                    className="rounded-full border border-border bg-background px-3 py-1 text-xs text-foreground"
                  >
                    {email}
                  </span>
                ))}
                {remainingPreviewCount > 0 && (
                  <span className="rounded-full border border-border bg-muted px-3 py-1 text-xs text-muted-foreground">
                    +{remainingPreviewCount} more
                  </span>
                )}
              </div>
            </div>
          )}
        </div>

        <div className="space-y-4">
          <div className="rounded-2xl border border-border bg-muted/20 p-4">
            <h4 className="text-sm font-medium text-foreground">How bulk invites work</h4>
            <ul className="mt-3 space-y-3 text-sm text-muted-foreground">
              <li className="flex gap-3">
                <span className="mt-0.5 h-2 w-2 rounded-full bg-org-secondary" />
                One invite batch is created for the selected role and expiration date.
              </li>
              <li className="flex gap-3">
                <span className="mt-0.5 h-2 w-2 rounded-full bg-org-secondary" />
                Each email gets one use in the batch invite.
              </li>
              <li className="flex gap-3">
                <span className="mt-0.5 h-2 w-2 rounded-full bg-org-secondary" />
                CSV uploads append recipients to anything you already pasted.
              </li>
            </ul>
          </div>

          <div className="rounded-2xl border border-border bg-background p-4">
            <h4 className="text-sm font-medium text-foreground">Recommended CSV format</h4>
            <div className="mt-3 overflow-hidden rounded-xl border border-border bg-muted/20">
              <div className="border-b border-border px-3 py-2 text-xs uppercase tracking-[0.18em] text-muted-foreground">
                Example
              </div>
              <pre className="overflow-x-auto px-3 py-3 text-xs text-foreground">email
jane@example.com
john@example.com
coach@example.com</pre>
            </div>
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-3 border-t border-border/70 px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs text-muted-foreground">
          Bulk invite links can be shared manually if email delivery is unavailable.
        </p>
        <div className="flex gap-3">
          <Button variant="secondary" onClick={onCancel}>
            {tCommon("cancel")}
          </Button>
          <Button
            onClick={handleSubmit}
            isLoading={isSubmitting}
            disabled={emails.length === 0 || emails.length > MAX_EMAILS_PER_BATCH}
          >
            Send {emails.length} invite{emails.length === 1 ? "" : "s"}
          </Button>
        </div>
      </div>
    </Card>
  );
}
