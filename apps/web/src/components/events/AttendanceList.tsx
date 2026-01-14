import type { RsvpStatus } from "@/types/database";

interface Attendee {
  userId: string;
  userName: string;
  status: RsvpStatus;
}

interface AttendanceListProps {
  attendees: Attendee[];
}

const statusOrder: RsvpStatus[] = ["attending", "maybe", "not_attending"];

const statusLabels: Record<RsvpStatus, { label: string; icon: string; color: string }> = {
  attending: {
    label: "Attending",
    icon: "check",
    color: "text-green-600 dark:text-green-400",
  },
  maybe: {
    label: "Maybe",
    icon: "question",
    color: "text-yellow-600 dark:text-yellow-400",
  },
  not_attending: {
    label: "Not Attending",
    icon: "x",
    color: "text-gray-500 dark:text-gray-400",
  },
};

export function AttendanceList({ attendees }: AttendanceListProps) {
  const grouped = statusOrder.reduce((acc, status) => {
    acc[status] = attendees.filter((a) => a.status === status);
    return acc;
  }, {} as Record<RsvpStatus, Attendee[]>);

  const attendingCount = grouped.attending.length;
  const maybeCount = grouped.maybe.length;
  const totalResponses = attendees.length;

  if (totalResponses === 0) {
    return (
      <div className="space-y-3">
        <p className="text-sm font-medium text-foreground">Attendance</p>
        <p className="text-sm text-muted-foreground">No RSVPs yet</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-foreground">Attendance</p>
        <span className="text-sm text-muted-foreground">
          {attendingCount} attending{maybeCount > 0 && ` (+${maybeCount} maybe)`}
        </span>
      </div>

      <div className="space-y-4">
        {statusOrder.map((status) => {
          const list = grouped[status];
          if (list.length === 0) return null;

          const config = statusLabels[status];

          return (
            <div key={status} className="space-y-2">
              <div className={`flex items-center gap-2 text-sm font-medium ${config.color}`}>
                {config.icon === "check" && (
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                )}
                {config.icon === "question" && (
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                )}
                {config.icon === "x" && (
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                )}
                {config.label} ({list.length})
              </div>
              <ul className="space-y-1 pl-6">
                {list.map((attendee) => (
                  <li key={attendee.userId} className="text-sm text-foreground">
                    {attendee.userName}
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
    </div>
  );
}
