import { notFound } from "next/navigation";
import { createServiceClient } from "@/lib/supabase/service";
import {
  fetchErrorGroupById,
  fetchErrorEvents,
  type ErrorGroup,
} from "@/lib/error-alerts/queries";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardHeader, CardTitle } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { ErrorGroupActions } from "../components/ErrorGroupActions";
import { ErrorEventsList } from "../components/ErrorEventsList";

interface PageProps {
  params: Promise<{ groupId: string }>;
}

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

function formatDateTime(dateString: string): string {
  return new Date(dateString).toLocaleString();
}

export default async function BugDetailPage({ params }: PageProps) {
  const { groupId } = await params;
  const supabase = createServiceClient();

  const [groupResult, eventsResult] = await Promise.all([
    fetchErrorGroupById(supabase, groupId),
    fetchErrorEvents(supabase, groupId, 50),
  ]);

  if (groupResult.error || !groupResult.data) {
    notFound();
  }

  const group = groupResult.data;
  const events = eventsResult.data;

  return (
    <div>
      <PageHeader
        title={group.title}
        description={`Error group ${group.id}`}
        backHref="/admin/bugs"
      />

      {/* Status and metadata */}
      <Card className="mb-6">
        <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-3">
              <Badge variant={getSeverityVariant(group.severity)}>
                {group.severity}
              </Badge>
              <Badge variant={getStatusVariant(group.status)}>
                {group.status}
              </Badge>
              <Badge variant="muted">{group.env}</Badge>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
              <div>
                <p className="text-muted-foreground">First seen</p>
                <p className="text-foreground font-medium">
                  {formatDateTime(group.first_seen_at)}
                </p>
              </div>
              <div>
                <p className="text-muted-foreground">Last seen</p>
                <p className="text-foreground font-medium">
                  {formatDateTime(group.last_seen_at)}
                </p>
              </div>
              <div>
                <p className="text-muted-foreground">Count (1h / 24h)</p>
                <p className="text-foreground font-medium">
                  {group.count_1h} / {group.count_24h}
                </p>
              </div>
              <div>
                <p className="text-muted-foreground">Total count</p>
                <p className="text-foreground font-medium">{group.total_count}</p>
              </div>
            </div>
          </div>
          <div className="md:text-right">
            <ErrorGroupActions groupId={group.id} currentStatus={group.status} />
          </div>
        </div>
      </Card>

      {/* Sample event */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Sample Event</CardTitle>
        </CardHeader>
        <pre className="bg-muted p-4 rounded-lg overflow-x-auto text-xs max-h-96">
          {JSON.stringify(group.sample_event, null, 2)}
        </pre>
      </Card>

      {/* Recent events */}
      <Card padding="none">
        <div className="p-6 border-b border-border">
          <h3 className="text-lg font-semibold text-foreground">
            Recent Events
            <span className="text-muted-foreground font-normal ml-2">
              (last 50)
            </span>
          </h3>
        </div>
        <ErrorEventsList events={events} />
      </Card>
    </div>
  );
}
