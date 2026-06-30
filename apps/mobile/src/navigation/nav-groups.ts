export type NavGroupId = "people" | "community" | "activity" | "finance" | "admin";

export type NavGroup = {
  id: NavGroupId;
  label: string;
};

export const ORG_NAV_GROUPS: NavGroup[] = [
  { id: "people", label: "People" },
  { id: "community", label: "Community" },
  { id: "activity", label: "Activity" },
  { id: "finance", label: "Finance" },
  { id: "admin", label: "Admin" },
];

export const NAV_GROUP_BY_CONFIG_KEY: Record<string, NavGroupId> = {
  "/members": "people",
  "/connections": "people",
  "/parents": "people",
  "/alumni": "people",
  "/mentorship": "people",
  "/chat": "community",
  "/announcements": "community",
  "/events": "community",
  "/jobs": "community",
  "/forms": "community",
  "/workouts": "activity",
  "/competition": "activity",
  "/records": "activity",
  "/schedules": "activity",
  "/philanthropy": "finance",
  "/donations": "finance",
  "/expenses": "finance",
  "/settings": "admin",
  "/settings/navigation": "admin",
};
