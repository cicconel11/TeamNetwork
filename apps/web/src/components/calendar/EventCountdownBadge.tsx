"use client";

import {
  describeEventStatus,
  getEventStatus,
  type EventStatus,
} from "@teammeet/core/calendar";
import { Badge } from "@/components/ui/Badge";
import { useNow } from "@/hooks/useNow";

interface EventCountdownBadgeProps {
  startAt: string;
  endAt: string | null;
  gracePeriodMinutes?: number;
  className?: string;
}

function variantFor(kind: EventStatus["kind"]): "primary" | "success" | "muted" {
  switch (kind) {
    case "live":
      return "success";
    case "starting-soon":
      return "primary";
    case "recently-ended":
    case "upcoming":
    case "past":
      return "muted";
  }
}

export function EventCountdownBadge({
  startAt,
  endAt,
  gracePeriodMinutes,
  className,
}: EventCountdownBadgeProps) {
  const now = useNow(startAt);
  const status = getEventStatus(startAt, endAt, now, gracePeriodMinutes);

  if (status.kind === "upcoming" || status.kind === "past") {
    return null;
  }

  return (
    <Badge variant={variantFor(status.kind)} className={className}>
      {describeEventStatus(status)}
    </Badge>
  );
}
