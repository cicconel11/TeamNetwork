"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Badge, Button, Card, EmptyState } from "@/components/ui";

type PendingDomain = {
  id: string;
  hostname: string;
  vendor_id: string;
  status: "pending";
  created_at: string | null;
  fingerprint: Record<string, unknown> | null;
};

interface ScheduleDomainApprovalsPanelProps {
  orgId: string;
  isAdmin: boolean;
}

function formatDateTime(value: string | null) {
  if (!value) return "";
  return new Date(value).toLocaleString();
}

function vendorLabel(vendor: string) {
  switch (vendor) {
    case "ics":
      return "ICS";
    case "sidearmsports":
      return "Sidearm Sports";
    case "prestosports":
      return "Presto Sports";
    case "sportsengine":
      return "SportsEngine";
    case "teamsnap":
      return "TeamSnap";
    case "leagueapps":
      return "LeagueApps";
    case "arbiter":
      return "ArbiterSports";
    case "bigteams":
      return "BigTeams";
    case "rankone":
      return "Rank One";
    case "rschooltoday":
      return "rSchoolToday";
    case "vantage":
      return "Vantage";
    case "vendorA":
      return "Vantage";
    case "vendorB":
      return "Sidearm";
    case "digitalsports":
      return "Digital Sports";
    default:
      return "Schedule";
  }
}

export function ScheduleDomainApprovalsPanel({ orgId, isAdmin }: ScheduleDomainApprovalsPanelProps) {
  const [domains, setDomains] = useState<PendingDomain[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [actionId, setActionId] = useState<string | null>(null);

  const loadDomains = useCallback(async () => {
    if (!isAdmin) return;
    setLoading(true);
    setError(null);

    try {
      const response = await fetch(`/api/admin/schedule-domains?orgId=${orgId}`);
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data?.message || "Failed to load pending domains.");
      }

      setDomains(data.domains || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load pending domains.");
    } finally {
      setLoading(false);
    }
  }, [isAdmin, orgId]);

  useEffect(() => {
    loadDomains();
  }, [loadDomains]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const handler = () => {
      loadDomains();
    };
    window.addEventListener("schedule:sources:refresh", handler);
    return () => {
      window.removeEventListener("schedule:sources:refresh", handler);
    };
  }, [loadDomains]);

  const handleAction = async (domainId: string, action: "approve" | "block") => {
    setActionId(domainId);
    setError(null);
    setNotice(null);

    try {
      const response = await fetch(`/api/admin/schedule-domains/${domainId}/${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orgId }),
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data?.message || "Failed to update domain.");
      }

      setNotice(action === "approve" ? "Domain approved." : "Domain blocked.");
      await loadDomains();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update domain.");
    } finally {
      setActionId(null);
    }
  };

  const domainCount = useMemo(() => domains.length, [domains]);

  if (!isAdmin) return null;

  return (
    <section id="schedule-domain-approvals">
      <h2 className="text-lg font-semibold text-foreground mb-4">Schedule Domain Approvals</h2>
      <Card className="p-4">
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading pending domains...</p>
        ) : domainCount === 0 ? (
          <EmptyState
            title="No pending domains"
            description="New schedule sources will appear here when they need approval."
          />
        ) : (
          <div className="space-y-3">
            {domains.map((domain) => (
              <div
                key={domain.id}
                className="flex flex-col gap-3 border border-border/60 rounded-xl p-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <p className="font-medium text-foreground">{domain.hostname}</p>
                    <Badge variant="warning">Pending</Badge>
                  </div>
                  <p className="text-sm text-muted-foreground">Vendor: {vendorLabel(domain.vendor_id)}</p>
                  {domain.created_at && (
                    <p className="text-xs text-muted-foreground">Requested: {formatDateTime(domain.created_at)}</p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    isLoading={actionId === domain.id}
                    onClick={() => handleAction(domain.id, "approve")}
                  >
                    Approve
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    isLoading={actionId === domain.id}
                    onClick={() => handleAction(domain.id, "block")}
                  >
                    Block
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
        {notice && <p className="mt-3 text-sm text-foreground">{notice}</p>}
        {error && <p className="mt-3 text-sm text-error">{error}</p>}
      </Card>
    </section>
  );
}
