"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Card, Button, Input, Badge, EmptyState } from "@/components/ui";
import { PageHeader } from "@/components/layout";

interface OrgPreview {
  id: string;
  name: string;
  slug: string;
  alumniCount: number;
}

interface AdoptionRequest {
  id: string;
  organization_id: string;
  organization_name: string;
  organization_slug: string;
  status: string;
  requested_at: string;
}

export function AdoptClient({ enterpriseSlug }: { enterpriseSlug: string }) {
  const router = useRouter();

  const [orgSlug, setOrgSlug] = useState("");
  const [preview, setPreview] = useState<OrgPreview | null>(null);
  const [isLoadingPreview, setIsLoadingPreview] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const [pendingRequests, setPendingRequests] = useState<AdoptionRequest[]>([]);
  const [isLoadingRequests, setIsLoadingRequests] = useState(true);

  const loadPendingRequests = useCallback(async () => {
    setIsLoadingRequests(true);
    try {
      const response = await fetch(`/api/enterprise/${enterpriseSlug}/adoption-requests`);
      if (response.ok) {
        const data = await response.json();
        const normalized = (data.requests || [])
          .filter((request: { status?: string }) => request.status === "pending")
          .map((request: {
            id: string;
            organization_id: string;
            organization_name?: string;
            organization_slug?: string;
            status: string;
            requested_at: string;
            organization?: { name?: string; slug?: string };
          }) => ({
            id: request.id,
            organization_id: request.organization_id,
            organization_name: request.organization?.name ?? request.organization_name ?? "Unknown",
            organization_slug: request.organization?.slug ?? request.organization_slug ?? "",
            status: request.status,
            requested_at: request.requested_at,
          }));
        setPendingRequests(normalized);
      }
    } catch {
      // Silently fail - not critical
    } finally {
      setIsLoadingRequests(false);
    }
  }, [enterpriseSlug]);

  useEffect(() => {
    loadPendingRequests();
  }, [loadPendingRequests]);

  const handlePreview = async () => {
    if (!orgSlug.trim()) {
      setPreviewError("Please enter an organization slug");
      return;
    }

    setIsLoadingPreview(true);
    setPreviewError(null);
    setPreview(null);

    try {
      const response = await fetch(
        `/api/enterprise/${enterpriseSlug}/adopt/preview?slug=${encodeURIComponent(orgSlug.trim())}`
      );

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Organization not found");
      }

      const data = await response.json();
      setPreview(data);
    } catch (err) {
      setPreviewError(err instanceof Error ? err.message : "Failed to fetch organization");
    } finally {
      setIsLoadingPreview(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!preview) {
      setError("Please preview the organization first");
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      const response = await fetch(`/api/enterprise/${enterpriseSlug}/adopt`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ organizationSlug: preview.slug }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to send adoption request");
      }

      setSuccessMessage("Adoption request sent successfully! The organization admin will be notified.");
      setOrgSlug("");
      setPreview(null);
      loadPendingRequests();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send adoption request");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCancelRequest = async (requestId: string) => {
    try {
      const response = await fetch(`/api/enterprise/${enterpriseSlug}/adoption-requests/${requestId}`, {
        method: "DELETE",
      });

      if (response.ok) {
        setPendingRequests((prev) => prev.filter((r) => r.id !== requestId));
      }
    } catch {
      // Silently fail
    }
  };

  return (
    <div className="animate-fade-in max-w-2xl mx-auto">
      <PageHeader
        title="Adopt Organization"
        description="Bring an existing organization under this enterprise"
        backHref={`/enterprise/${enterpriseSlug}/organizations`}
      />

      {/* Adoption Form */}
      <Card className="p-6 mb-6">
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <Input
              label="Organization Slug"
              placeholder="my-organization"
              value={orgSlug}
              onChange={(e) => {
                setOrgSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""));
                setPreview(null);
                setPreviewError(null);
                setSuccessMessage(null);
              }}
              error={previewError ?? undefined}
              disabled={isSubmitting}
            />
            <div className="mt-2">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={handlePreview}
                isLoading={isLoadingPreview}
                disabled={isLoadingPreview || isSubmitting || !orgSlug.trim()}
              >
                Preview Organization
              </Button>
            </div>
          </div>

          {preview && (
            <Card padding="sm" className="bg-muted/50">
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-foreground">{preview.name}</span>
                  <span className="text-xs text-muted-foreground">/{preview.slug}</span>
                </div>
                <div className="text-sm text-muted-foreground">
                  {preview.alumniCount.toLocaleString()} alumni
                </div>
              </div>
            </Card>
          )}

          {/* Warning */}
          <div className="p-3 rounded-xl bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-300 text-sm space-y-1">
            <p className="font-medium">What happens when you adopt an organization:</p>
            <ul className="list-disc list-inside space-y-0.5 text-xs">
              <li>A request will be sent to the organization admin</li>
              <li>If accepted, billing will transfer to this enterprise</li>
              <li>Alumni counts will be pooled with your enterprise quota</li>
              <li>The organization will retain its settings and data</li>
            </ul>
          </div>

          {error && (
            <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
              <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
            </div>
          )}

          {successMessage && (
            <div className="p-3 bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 rounded-lg">
              <p className="text-sm text-emerald-600 dark:text-emerald-400">{successMessage}</p>
            </div>
          )}

          <div className="flex gap-3 pt-2">
            <Button
              type="button"
              variant="secondary"
              onClick={() => router.push(`/enterprise/${enterpriseSlug}/organizations`)}
              disabled={isSubmitting}
              className="flex-1"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant="primary"
              isLoading={isSubmitting}
              disabled={isSubmitting || !preview}
              className="flex-1"
            >
              Send Request
            </Button>
          </div>
        </form>
      </Card>

      {/* Pending Requests */}
      <Card>
        <div className="p-6 border-b border-border">
          <h2 className="font-semibold text-foreground">Pending Adoption Requests</h2>
          <p className="text-sm text-muted-foreground">
            Requests awaiting organization admin approval
          </p>
        </div>

        {isLoadingRequests ? (
          <div className="p-8 text-center text-muted-foreground">Loading...</div>
        ) : pendingRequests.length === 0 ? (
          <EmptyState
            icon={<ClockIcon className="h-12 w-12" />}
            title="No pending requests"
            description="Adoption requests you send will appear here"
          />
        ) : (
          <div className="divide-y divide-border">
            {pendingRequests.map((request) => (
              <div key={request.id} className="p-4 flex items-center justify-between gap-4">
                <div>
                  <p className="font-medium text-foreground">{request.organization_name}</p>
                  <p className="text-sm text-muted-foreground">/{request.organization_slug}</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Requested {new Date(request.requested_at).toLocaleDateString()}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <Badge variant="warning">Pending</Badge>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleCancelRequest(request.id)}
                    className="text-red-500 hover:text-red-600"
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

function ClockIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z"
      />
    </svg>
  );
}
