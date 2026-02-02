"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { Card, Button, Badge } from "@/components/ui";
import { PageHeader } from "@/components/layout";

interface AdoptionRequestDetails {
  id: string;
  status: string;
  requested_at: string;
  expires_at: string | null;
  enterprise: {
    id: string;
    name: string;
    slug: string;
    description: string | null;
    logo_url: string | null;
  };
  requester: {
    name: string | null;
    email: string | null;
  };
}

export default function AdoptionRequestPage() {
  const params = useParams();
  const router = useRouter();
  const orgSlug = params.orgSlug as string;
  const requestId = params.requestId as string;

  const [request, setRequest] = useState<AdoptionRequestDetails | null>(null);
  const [orgId, setOrgId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const loadRequest = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      // First get org ID from slug
      const orgResponse = await fetch(`/api/organizations/by-slug/${encodeURIComponent(orgSlug)}`);
      const orgData = await orgResponse.json();

      if (!orgResponse.ok || !orgData.id) {
        throw new Error("Organization not found");
      }

      setOrgId(orgData.id);

      // Then get adoption request
      const response = await fetch(
        `/api/organizations/${orgData.id}/adoption-requests/${requestId}`
      );
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to load adoption request");
      }

      setRequest(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load request");
    } finally {
      setIsLoading(false);
    }
  }, [orgSlug, requestId]);

  useEffect(() => {
    loadRequest();
  }, [loadRequest]);

  const handleAccept = async () => {
    if (!orgId) return;

    setIsProcessing(true);
    setError(null);

    try {
      const response = await fetch(
        `/api/organizations/${orgId}/adoption-requests/${requestId}/accept`,
        { method: "POST" }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to accept request");
      }

      setSuccessMessage("Adoption request accepted! Your organization is now part of the enterprise.");
      setRequest((prev) => (prev ? { ...prev, status: "accepted" } : null));

      // Redirect after short delay
      setTimeout(() => {
        router.push(`/${orgSlug}`);
      }, 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to accept request");
    } finally {
      setIsProcessing(false);
    }
  };

  const handleReject = async () => {
    if (!orgId) return;

    if (!confirm("Are you sure you want to reject this adoption request?")) return;

    setIsProcessing(true);
    setError(null);

    try {
      const response = await fetch(
        `/api/organizations/${orgId}/adoption-requests/${requestId}/reject`,
        { method: "POST" }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to reject request");
      }

      setSuccessMessage("Adoption request rejected.");
      setRequest((prev) => (prev ? { ...prev, status: "rejected" } : null));

      // Redirect after short delay
      setTimeout(() => {
        router.push(`/${orgSlug}/settings/invites`);
      }, 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to reject request");
    } finally {
      setIsProcessing(false);
    }
  };

  if (isLoading) {
    return (
      <div className="animate-fade-in max-w-2xl mx-auto">
        <PageHeader title="Adoption Request" description="Loading..." />
        <div className="animate-pulse space-y-4">
          <div className="h-64 bg-muted rounded-xl" />
        </div>
      </div>
    );
  }

  if (!request) {
    return (
      <div className="animate-fade-in max-w-2xl mx-auto">
        <PageHeader title="Adoption Request" backHref={`/${orgSlug}/settings/invites`} />
        <Card className="p-8 text-center">
          <p className="text-muted-foreground">Adoption request not found.</p>
        </Card>
      </div>
    );
  }

  const isPending = request.status === "pending";
  const isExpired = request.expires_at && new Date(request.expires_at) < new Date();

  return (
    <div className="animate-fade-in max-w-2xl mx-auto">
      <PageHeader
        title="Adoption Request"
        description="Review this enterprise adoption request"
        backHref={`/${orgSlug}/settings/invites`}
      />

      {error && (
        <div className="mb-6 p-4 rounded-xl bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 text-sm">
          {error}
        </div>
      )}

      {successMessage && (
        <div className="mb-6 p-4 rounded-xl bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600 dark:text-emerald-400 text-sm">
          {successMessage}
        </div>
      )}

      {/* Enterprise Details */}
      <Card className="p-6 mb-6">
        <div className="flex items-start gap-4 mb-6">
          {request.enterprise.logo_url ? (
            <div className="h-16 w-16 rounded-xl overflow-hidden bg-muted flex-shrink-0">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={request.enterprise.logo_url}
                alt={request.enterprise.name}
                className="h-full w-full object-cover"
              />
            </div>
          ) : (
            <div className="h-16 w-16 rounded-xl flex items-center justify-center bg-purple-600 text-white font-bold text-2xl flex-shrink-0">
              {request.enterprise.name.charAt(0)}
            </div>
          )}
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <h2 className="text-xl font-semibold text-foreground">{request.enterprise.name}</h2>
              <Badge
                variant={
                  request.status === "pending"
                    ? "warning"
                    : request.status === "accepted"
                    ? "success"
                    : "error"
                }
              >
                {request.status}
              </Badge>
            </div>
            {request.enterprise.description && (
              <p className="text-muted-foreground mt-1">{request.enterprise.description}</p>
            )}
          </div>
        </div>

        <div className="space-y-3 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Requested by</span>
            <span className="text-foreground">
              {request.requester.name || request.requester.email || "Unknown"}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Requested at</span>
            <span className="text-foreground">
              {new Date(request.requested_at).toLocaleDateString()}
            </span>
          </div>
          {request.expires_at && (
            <div className="flex justify-between">
              <span className="text-muted-foreground">Expires</span>
              <span className={isExpired ? "text-red-500" : "text-foreground"}>
                {new Date(request.expires_at).toLocaleDateString()}
                {isExpired && " (Expired)"}
              </span>
            </div>
          )}
        </div>
      </Card>

      {/* What happens */}
      <Card className="p-6 mb-6 border-amber-300 dark:border-amber-700/50 bg-amber-50/50 dark:bg-amber-900/10">
        <h3 className="font-semibold text-amber-800 dark:text-amber-200 mb-3">
          What happens if you accept?
        </h3>
        <ul className="space-y-2 text-sm text-amber-700 dark:text-amber-300">
          <li className="flex items-start gap-2">
            <CheckIcon className="h-5 w-5 flex-shrink-0 mt-0.5" />
            <span>Your organization will become part of the enterprise</span>
          </li>
          <li className="flex items-start gap-2">
            <CheckIcon className="h-5 w-5 flex-shrink-0 mt-0.5" />
            <span>Billing will transfer to the enterprise (you won&apos;t pay separately)</span>
          </li>
          <li className="flex items-start gap-2">
            <CheckIcon className="h-5 w-5 flex-shrink-0 mt-0.5" />
            <span>Alumni counts will be pooled with the enterprise quota</span>
          </li>
          <li className="flex items-start gap-2">
            <CheckIcon className="h-5 w-5 flex-shrink-0 mt-0.5" />
            <span>Your organization will retain all its settings and data</span>
          </li>
        </ul>
      </Card>

      {/* Actions */}
      {isPending && !isExpired ? (
        <div className="flex gap-4">
          <Button
            variant="secondary"
            onClick={handleReject}
            isLoading={isProcessing}
            disabled={isProcessing}
            className="flex-1"
          >
            Reject
          </Button>
          <Button
            onClick={handleAccept}
            isLoading={isProcessing}
            disabled={isProcessing}
            className="flex-1"
          >
            Accept
          </Button>
        </div>
      ) : (
        <Card className="p-4 text-center text-muted-foreground">
          {isExpired
            ? "This request has expired."
            : `This request has been ${request.status}.`}
        </Card>
      )}
    </div>
  );
}

function CheckIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
    </svg>
  );
}
