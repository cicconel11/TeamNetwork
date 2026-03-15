"use client";

import { Badge } from "@/components/ui";

interface Organization {
  id: string;
  name: string;
  slug: string;
  enterprise_nav_synced_at: string | null;
}

interface OrgSyncStatusProps {
  organizations: Organization[];
  lastConfigUpdate?: string;
}

export function OrgSyncStatus({ organizations, lastConfigUpdate }: OrgSyncStatusProps) {
  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  };

  const getSyncStatus = (org: Organization): "synced" | "outdated" | "never" => {
    if (!org.enterprise_nav_synced_at) return "never";
    if (!lastConfigUpdate) return "synced";

    const syncedAt = new Date(org.enterprise_nav_synced_at);
    const configAt = new Date(lastConfigUpdate);

    return syncedAt >= configAt ? "synced" : "outdated";
  };

  const syncedCount = organizations.filter((o) => getSyncStatus(o) === "synced").length;
  const outdatedCount = organizations.filter((o) => getSyncStatus(o) === "outdated").length;
  const neverCount = organizations.filter((o) => getSyncStatus(o) === "never").length;

  return (
    <div className="bg-card border border-border rounded-xl p-4">
      <h3 className="font-medium text-foreground mb-3">Sync Status</h3>

      {/* Summary */}
      <div className="flex items-center gap-3 mb-4">
        {syncedCount > 0 && (
          <Badge variant="success">{syncedCount} synced</Badge>
        )}
        {outdatedCount > 0 && (
          <Badge variant="warning">{outdatedCount} outdated</Badge>
        )}
        {neverCount > 0 && (
          <Badge variant="muted">{neverCount} never synced</Badge>
        )}
      </div>

      {/* Organization List */}
      <div className="space-y-2 max-h-48 overflow-y-auto">
        {organizations.map((org) => {
          const status = getSyncStatus(org);
          return (
            <div
              key={org.id}
              className="flex items-center justify-between py-2 px-3 rounded-lg bg-muted/30"
            >
              <span className="text-sm text-foreground truncate">{org.name}</span>
              <div className="flex items-center gap-2">
                {status === "synced" && (
                  <CheckIcon className="h-4 w-4 text-emerald-500" />
                )}
                {status === "outdated" && (
                  <WarningIcon className="h-4 w-4 text-amber-500" />
                )}
                {status === "never" && (
                  <MinusIcon className="h-4 w-4 text-muted-foreground" />
                )}
                <span className="text-xs text-muted-foreground">
                  {org.enterprise_nav_synced_at
                    ? formatDate(org.enterprise_nav_synced_at)
                    : "Never"}
                </span>
              </div>
            </div>
          );
        })}
      </div>
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

function WarningIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z"
      />
    </svg>
  );
}

function MinusIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 12h-15" />
    </svg>
  );
}
