import Link from "next/link";
import { createServiceClient } from "@/lib/supabase/service";
import { fetchErrorGroups, type ErrorGroup } from "@/lib/error-alerts/queries";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";

type StatusFilter = "open" | "resolved" | "ignored" | "muted" | "all";

interface PageProps {
  searchParams: Promise<{ status?: string }>;
}

const STATUS_TABS: { value: StatusFilter; label: string }[] = [
  { value: "open", label: "Open" },
  { value: "resolved", label: "Resolved" },
  { value: "ignored", label: "Ignored" },
  { value: "muted", label: "Muted" },
  { value: "all", label: "All" },
];

function getSeverityVariant(severity: ErrorGroup["severity"]): "error" | "warning" | "primary" | "muted" {
  switch (severity) {
    case "critical":
      return "error";
    case "high":
      return "warning";
    case "medium":
      return "primary";
    case "low":
    default:
      return "muted";
  }
}

function getStatusVariant(status: ErrorGroup["status"]): "error" | "success" | "muted" {
  switch (status) {
    case "open":
      return "error";
    case "resolved":
      return "success";
    case "ignored":
    case "muted":
    default:
      return "muted";
  }
}

function formatRelativeTime(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}

export default async function AdminBugsPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const statusFilter = (params.status as StatusFilter) || "open";

  const supabase = createServiceClient();
  const { data: groups, error } = await fetchErrorGroups(supabase, {
    status: statusFilter === "all" ? undefined : statusFilter as ErrorGroup["status"],
    limit: 100,
  });

  if (error) {
    return (
      <div>
        <PageHeader
          title="Bug Dashboard"
          description="Monitor and manage error groups"
        />
        <Card>
          <p className="text-error">Failed to load error groups: {error.message}</p>
        </Card>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Bug Dashboard"
        description="Monitor and manage error groups"
      />

      {/* Status filter tabs */}
      <div className="flex gap-2 mb-6 border-b border-border pb-4">
        {STATUS_TABS.map((tab) => (
          <Link
            key={tab.value}
            href={`/admin/bugs${tab.value === "open" ? "" : `?status=${tab.value}`}`}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              statusFilter === tab.value
                ? "bg-org-secondary text-org-secondary-foreground"
                : "bg-muted text-muted-foreground hover:bg-border"
            }`}
          >
            {tab.label}
          </Link>
        ))}
      </div>

      {groups.length === 0 ? (
        <Card>
          <EmptyState
            icon={
              <svg className="h-12 w-12" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            }
            title={`No ${statusFilter === "all" ? "" : statusFilter + " "}errors`}
            description={statusFilter === "open" ? "All caught up! No open errors to review." : `No errors with status "${statusFilter}" found.`}
          />
        </Card>
      ) : (
        <div className="space-y-3">
          {groups.map((group) => (
            <Link key={group.id} href={`/admin/bugs/${group.id}`}>
              <Card interactive className="hover:border-org-secondary/50">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <Badge variant={getSeverityVariant(group.severity)}>
                        {group.severity}
                      </Badge>
                      <Badge variant={getStatusVariant(group.status)}>
                        {group.status}
                      </Badge>
                      <Badge variant="muted">{group.env}</Badge>
                    </div>
                    <h3 className="text-foreground font-medium truncate">
                      {group.title}
                    </h3>
                    <p className="text-sm text-muted-foreground mt-1">
                      Last seen {formatRelativeTime(group.last_seen_at)}
                    </p>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <div className="text-sm text-muted-foreground">
                      <span className="font-medium text-foreground">{group.count_1h}</span> / 1h
                    </div>
                    <div className="text-sm text-muted-foreground">
                      <span className="font-medium text-foreground">{group.count_24h}</span> / 24h
                    </div>
                    <div className="text-sm text-muted-foreground">
                      <span className="font-medium text-foreground">{group.total_count}</span> total
                    </div>
                  </div>
                </div>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
