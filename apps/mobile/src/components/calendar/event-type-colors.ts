import type { CalendarSourceType } from "@/hooks/useUnifiedCalendar";

export const EVENT_TYPE_COLORS: Record<
  string,
  { bg: string; text: string; chip: string }
> = {
  general: { bg: "rgba(99,102,241,0.15)", text: "#6366f1", chip: "#6366f1" },
  meeting: { bg: "rgba(245,158,11,0.15)", text: "#f59e0b", chip: "#f59e0b" },
  game: { bg: "rgba(244,63,94,0.15)", text: "#f43f5e", chip: "#f43f5e" },
  social: { bg: "rgba(236,72,153,0.15)", text: "#ec4899", chip: "#ec4899" },
  philanthropy: {
    bg: "rgba(139,92,246,0.15)",
    text: "#8b5cf6",
    chip: "#8b5cf6",
  },
  fundraiser: {
    bg: "rgba(16,185,129,0.15)",
    text: "#10b981",
    chip: "#10b981",
  },
  schedule: { bg: "rgba(14,165,233,0.15)", text: "#0ea5e9", chip: "#0ea5e9" },
};

export function getEventColor(
  eventType: string | null,
  sourceType: CalendarSourceType
) {
  if (sourceType === "schedule") return EVENT_TYPE_COLORS.schedule;
  return EVENT_TYPE_COLORS[eventType ?? "general"] ?? EVENT_TYPE_COLORS.general;
}
