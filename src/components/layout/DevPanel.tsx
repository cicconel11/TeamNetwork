"use client";

import { useEffect, useRef, useState } from "react";

interface DevPanelProps {
  organizationId: string;
  orgSlug: string;
  orgName: string;
  subscriptionStatus: string | null;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  currentPeriodEnd: string | null;
  gracePeriodEndsAt: string | null;
  userRole: string | null;
  memberCount?: number;
}

interface Organization {
  id: string;
  name: string;
  slug: string;
  created_at: string;
  member_count: number;
  subscription: {
    status: string;
    stripe_subscription_id: string | null;
    current_period_end: string | null;
  } | null;
}

export function DevPanel({
  organizationId,
  orgSlug,
  orgName,
  subscriptionStatus,
  stripeCustomerId,
  stripeSubscriptionId,
  currentPeriodEnd,
  gracePeriodEndsAt,
  userRole,
  memberCount,
}: DevPanelProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [isReconciling, setIsReconciling] = useState(false);
  const [reconcileResult, setReconcileResult] = useState<string | null>(null);
  const [showAllOrgs, setShowAllOrgs] = useState(false);
  const [allOrgs, setAllOrgs] = useState<Organization[]>([]);
  const [isLoadingOrgs, setIsLoadingOrgs] = useState(false);
  const isMountedRef = useRef(true);
  const reloadTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      isMountedRef.current = false;
      if (reloadTimeoutRef.current) {
        clearTimeout(reloadTimeoutRef.current);
      }
    };
  }, []);

  const handleReconcile = async () => {
    setIsReconciling(true);
    setReconcileResult(null);
    try {
      const res = await fetch(`/api/organizations/${organizationId}/reconcile-subscription`, {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) {
        setReconcileResult(`Error: ${data.error || res.statusText}`);
      } else {
        setReconcileResult(`Success: status=${data.status}, synced from Stripe`);
        // Reload after short delay to show updated data
        reloadTimeoutRef.current = setTimeout(() => {
          if (isMountedRef.current) {
            window.location.reload();
          }
        }, 1500);
      }
    } catch (err) {
      setReconcileResult(`Error: ${err instanceof Error ? err.message : "Unknown error"}`);
    } finally {
      setIsReconciling(false);
    }
  };

  const handleOpenBillingPortal = async () => {
    try {
      const res = await fetch("/api/stripe/billing-portal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ organizationId }),
      });
      const data = await res.json();
      if (!res.ok || !data.url) {
        alert(`Error: ${data.error || "Unable to open billing portal"}`);
        return;
      }
      window.open(data.url, "_blank");
    } catch (err) {
      alert(`Error: ${err instanceof Error ? err.message : "Unknown error"}`);
    }
  };

  const fetchAllOrgs = async () => {
    setIsLoadingOrgs(true);
    try {
      const res = await fetch("/api/dev-admin/organizations");
      const data = await res.json();
      if (!res.ok) {
        alert(`Error: ${data.error || "Unable to fetch organizations"}`);
        return;
      }
      setAllOrgs(data.organizations ?? []);
      setShowAllOrgs(true);
    } catch (err) {
      alert(`Error: ${err instanceof Error ? err.message : "Unknown error"}`);
    } finally {
      setIsLoadingOrgs(false);
    }
  };

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return "null";
    try {
      return new Date(dateStr).toLocaleString();
    } catch {
      return dateStr;
    }
  };

  const getStatusColor = (status: string | null) => {
    switch (status) {
      case "active":
      case "trialing":
        return "text-green-400";
      case "canceled":
      case "canceling":
        return "text-yellow-400";
      case "past_due":
      case "unpaid":
        return "text-red-400";
      default:
        return "text-gray-400";
    }
  };

  return (
    <div className="fixed bottom-4 right-4 z-50">
      {/* Toggle button */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="bg-purple-600 hover:bg-purple-700 text-white px-3 py-2 rounded-lg shadow-lg flex items-center gap-2 text-sm font-medium transition-colors"
      >
        <span className="text-xs">🔧</span>
        Dev Panel
        <span className="text-xs">{isExpanded ? "▼" : "▲"}</span>
      </button>

      {/* Expanded panel */}
      {isExpanded && (
        <div className="absolute bottom-12 right-0 w-96 bg-gray-900 border border-gray-700 rounded-lg shadow-2xl text-white text-xs overflow-hidden">
          {/* Header */}
          <div className="bg-purple-600 px-4 py-2 flex items-center justify-between">
            <span className="font-semibold">Dev Admin Panel</span>
            <span className="text-purple-200 text-xs">Hidden from members</span>
          </div>

          {/* Content */}
          <div className="p-4 space-y-4 max-h-96 overflow-y-auto">
            {/* Org Info */}
            <section>
              <h3 className="text-gray-400 uppercase tracking-wide text-xs mb-2">Organization</h3>
              <div className="space-y-1 font-mono">
                <div><span className="text-gray-500">name:</span> {orgName}</div>
                <div><span className="text-gray-500">slug:</span> {orgSlug}</div>
                <div><span className="text-gray-500">id:</span> <span className="text-gray-400 select-all">{organizationId}</span></div>
                <div><span className="text-gray-500">your_role:</span> {userRole || "none (dev-admin)"}</div>
                {memberCount !== undefined && (
                  <div><span className="text-gray-500">members:</span> {memberCount}</div>
                )}
              </div>
            </section>

            {/* Subscription Info */}
            <section>
              <h3 className="text-gray-400 uppercase tracking-wide text-xs mb-2">Subscription</h3>
              <div className="space-y-1 font-mono">
                <div>
                  <span className="text-gray-500">status:</span>{" "}
                  <span className={getStatusColor(subscriptionStatus)}>
                    {subscriptionStatus || "null"}
                  </span>
                </div>
                <div><span className="text-gray-500">current_period_end:</span> {formatDate(currentPeriodEnd)}</div>
                <div><span className="text-gray-500">grace_period_ends_at:</span> {formatDate(gracePeriodEndsAt)}</div>
              </div>
            </section>

            {/* Stripe IDs */}
            <section>
              <h3 className="text-gray-400 uppercase tracking-wide text-xs mb-2">Stripe</h3>
              <div className="space-y-1 font-mono">
                <div>
                  <span className="text-gray-500">customer_id:</span>{" "}
                  <span className="text-gray-400 select-all">{stripeCustomerId || "null"}</span>
                </div>
                <div>
                  <span className="text-gray-500">subscription_id:</span>{" "}
                  <span className="text-gray-400 select-all">{stripeSubscriptionId || "null"}</span>
                </div>
              </div>
            </section>

            {/* Actions */}
            <section>
              <h3 className="text-gray-400 uppercase tracking-wide text-xs mb-2">Actions</h3>
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={handleReconcile}
                  disabled={isReconciling}
                  className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 px-3 py-1.5 rounded text-xs font-medium transition-colors"
                >
                  {isReconciling ? "Reconciling..." : "Reconcile Subscription"}
                </button>
                <button
                  onClick={handleOpenBillingPortal}
                  disabled={!stripeCustomerId}
                  className="bg-green-600 hover:bg-green-700 disabled:opacity-50 px-3 py-1.5 rounded text-xs font-medium transition-colors"
                >
                  Billing Portal
                </button>
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(organizationId);
                    alert("Org ID copied!");
                  }}
                  className="bg-gray-600 hover:bg-gray-700 px-3 py-1.5 rounded text-xs font-medium transition-colors"
                >
                  Copy Org ID
                </button>
                <button
                  onClick={fetchAllOrgs}
                  disabled={isLoadingOrgs}
                  className="bg-orange-600 hover:bg-orange-700 disabled:opacity-50 px-3 py-1.5 rounded text-xs font-medium transition-colors"
                >
                  {isLoadingOrgs ? "Loading..." : "View All Orgs"}
                </button>
              </div>
              {reconcileResult && (
                <div className={`mt-2 p-2 rounded text-xs ${reconcileResult.startsWith("Error") ? "bg-red-900/50" : "bg-green-900/50"}`}>
                  {reconcileResult}
                </div>
              )}
            </section>

            {/* Quick Links */}
            <section>
              <h3 className="text-gray-400 uppercase tracking-wide text-xs mb-2">Quick Links</h3>
              <div className="flex flex-wrap gap-2">
                {stripeCustomerId && (
                  <a
                    href={`https://dashboard.stripe.com/customers/${stripeCustomerId}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-400 hover:text-blue-300 underline"
                  >
                    Stripe Customer →
                  </a>
                )}
                {stripeSubscriptionId && (
                  <a
                    href={`https://dashboard.stripe.com/subscriptions/${stripeSubscriptionId}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-400 hover:text-blue-300 underline"
                  >
                    Stripe Subscription →
                  </a>
                )}
              </div>
            </section>
          </div>
        </div>
      )}

      {/* All Orgs Modal */}
      {showAllOrgs && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
          onClick={() => setShowAllOrgs(false)}
        >
          <div
            className="bg-white rounded-lg p-6 max-w-6xl w-full max-h-[80vh] overflow-auto text-gray-900 m-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold">All Organizations ({allOrgs.length})</h3>
              <button
                onClick={() => setShowAllOrgs(false)}
                className="text-gray-500 hover:text-gray-700 text-2xl"
              >
                ×
              </button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b-2 border-gray-300">
                    <th className="text-left py-2 px-3 font-semibold">Name</th>
                    <th className="text-left py-2 px-3 font-semibold">Slug</th>
                    <th className="text-left py-2 px-3 font-semibold">Members</th>
                    <th className="text-left py-2 px-3 font-semibold">Created</th>
                    <th className="text-left py-2 px-3 font-semibold">Subscription</th>
                  </tr>
                </thead>
                <tbody>
                  {allOrgs.map((org) => (
                    <tr key={org.id} className="border-b hover:bg-gray-50 transition-colors">
                      <td className="py-3 px-3 font-medium">{org.name}</td>
                      <td className="py-3 px-3">
                        <a
                          href={`/${org.slug}`}
                          className="text-blue-600 hover:text-blue-800 hover:underline"
                        >
                          {org.slug}
                        </a>
                      </td>
                      <td className="py-3 px-3">{org.member_count}</td>
                      <td className="py-3 px-3">
                        {new Date(org.created_at).toLocaleDateString()}
                      </td>
                      <td className="py-3 px-3">
                        <span className={`inline-block px-2 py-1 rounded text-xs font-medium ${
                          org.subscription?.status === "active" || org.subscription?.status === "trialing"
                            ? "bg-green-100 text-green-800"
                            : org.subscription?.status === "past_due" || org.subscription?.status === "unpaid"
                            ? "bg-red-100 text-red-800"
                            : org.subscription?.status === "canceled" || org.subscription?.status === "canceling"
                            ? "bg-yellow-100 text-yellow-800"
                            : "bg-gray-100 text-gray-800"
                        }`}>
                          {org.subscription?.status || "None"}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-6 flex justify-end">
              <button
                onClick={() => setShowAllOrgs(false)}
                className="bg-gray-500 hover:bg-gray-600 text-white px-4 py-2 rounded font-medium transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
