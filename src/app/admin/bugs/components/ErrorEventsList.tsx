"use client";

import { useState } from "react";
import type { ErrorEvent } from "@/lib/error-alerts/queries";

interface ErrorEventsListProps {
  events: ErrorEvent[];
}

function formatDateTime(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function truncateMessage(message: string, maxLength: number = 100): string {
  if (message.length <= maxLength) return message;
  return message.slice(0, maxLength) + "...";
}

export function ErrorEventsList({ events }: ErrorEventsListProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  if (events.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        No events recorded for this error group.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border">
            <th className="text-left py-3 px-4 font-medium text-muted-foreground">Time</th>
            <th className="text-left py-3 px-4 font-medium text-muted-foreground">Message</th>
            <th className="text-left py-3 px-4 font-medium text-muted-foreground">Route</th>
            <th className="text-left py-3 px-4 font-medium text-muted-foreground">User</th>
          </tr>
        </thead>
        <tbody>
          {events.map((event) => (
            <tr
              key={event.id}
              className="border-b border-border/50 hover:bg-muted/50 cursor-pointer transition-colors"
              onClick={() => setExpandedId(expandedId === event.id ? null : event.id)}
            >
              <td className="py-3 px-4 whitespace-nowrap text-muted-foreground">
                {formatDateTime(event.created_at)}
              </td>
              <td className="py-3 px-4">
                <span className="text-foreground">
                  {truncateMessage(event.message)}
                </span>
                {expandedId === event.id && event.stack && (
                  <pre className="mt-2 p-3 bg-muted rounded-lg text-xs overflow-x-auto max-h-48 whitespace-pre-wrap">
                    {event.stack}
                  </pre>
                )}
              </td>
              <td className="py-3 px-4 text-muted-foreground">
                {event.route || event.api_path || "-"}
              </td>
              <td className="py-3 px-4 text-muted-foreground font-mono text-xs">
                {event.user_id ? event.user_id.slice(0, 8) + "..." : "-"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
