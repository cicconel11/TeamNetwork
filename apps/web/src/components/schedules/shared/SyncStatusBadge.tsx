import { Badge } from "@/components/ui";
import type { SourceStatus } from "@/hooks";

type SyncStatusBadgeProps = {
  status: SourceStatus;
  variant?: "badge" | "dot";
};

export function statusVariant(status: SourceStatus): "success" | "warning" | "error" | "muted" {
  switch (status) {
    case "active":
      return "success";
    case "paused":
      return "warning";
    case "error":
      return "error";
    default:
      return "muted";
  }
}

function statusLabel(status: SourceStatus): string {
  switch (status) {
    case "active":
      return "Active";
    case "paused":
      return "Paused";
    case "error":
      return "Error";
    default:
      return status;
  }
}

function statusDotColor(status: SourceStatus): string {
  switch (status) {
    case "active":
      return "bg-success";
    case "paused":
      return "bg-warning";
    case "error":
      return "bg-error";
    default:
      return "bg-muted-foreground";
  }
}

export function SyncStatusBadge({ status, variant = "badge" }: SyncStatusBadgeProps) {
  if (variant === "dot") {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <span className={`w-2 h-2 rounded-full ${statusDotColor(status)}`} />
        {statusLabel(status)}
      </span>
    );
  }

  return <Badge variant={statusVariant(status)}>{status}</Badge>;
}
