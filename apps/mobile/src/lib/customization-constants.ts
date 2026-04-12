import type { SelectOption } from "@/types/mentorship";

// Timezone options — matches web's customization-timezones.ts
export const TIMEZONE_OPTIONS: SelectOption[] = [
  { value: "America/New_York", label: "Eastern Time (New York)" },
  { value: "America/Chicago", label: "Central Time (Chicago)" },
  { value: "America/Denver", label: "Mountain Time (Denver)" },
  { value: "America/Los_Angeles", label: "Pacific Time (Los Angeles)" },
  { value: "America/Anchorage", label: "Alaska Time (Anchorage)" },
  { value: "Pacific/Honolulu", label: "Hawaii Time (Honolulu)" },
  { value: "America/Phoenix", label: "Arizona (Phoenix)" },
  { value: "America/Toronto", label: "Eastern Time (Toronto)" },
  { value: "America/Vancouver", label: "Pacific Time (Vancouver)" },
  { value: "America/Mexico_City", label: "Central Time (Mexico City)" },
  { value: "Europe/London", label: "Greenwich Mean Time (London)" },
  { value: "Europe/Berlin", label: "Central European Time (Berlin)" },
  { value: "Europe/Paris", label: "Central European Time (Paris)" },
  { value: "Asia/Tokyo", label: "Japan Standard Time (Tokyo)" },
  { value: "Asia/Shanghai", label: "China Standard Time (Shanghai)" },
  { value: "Asia/Kolkata", label: "India Standard Time (Kolkata)" },
  { value: "Asia/Dubai", label: "Gulf Standard Time (Dubai)" },
  { value: "Australia/Sydney", label: "Australian Eastern Time (Sydney)" },
  { value: "Pacific/Auckland", label: "New Zealand Time (Auckland)" },
  { value: "UTC", label: "Coordinated Universal Time (UTC)" },
];

// Language options — matches web's LOCALE_NAMES
export const LANGUAGE_OPTIONS: SelectOption[] = [
  { value: "en", label: "English" },
  { value: "es", label: "Espanol" },
  { value: "fr", label: "Francais" },
  { value: "ar", label: "\u0627\u0644\u0639\u0631\u0628\u064A\u0629" },
  { value: "zh", label: "\u4E2D\u6587" },
  { value: "pt", label: "Portugues" },
  { value: "it", label: "Italiano" },
];

// Preset color palette for quick selection
export const COLOR_PRESETS = [
  "#1e3a5f",
  "#0f172a",
  "#059669",
  "#0284c7",
  "#7c3aed",
  "#dc2626",
  "#d97706",
  "#db2777",
  "#0d9488",
  "#4f46e5",
] as const;

// Permission card configurations
export interface PermissionCardConfig {
  field: string;
  title: string;
  subtitle: string;
  defaultRoles: string[];
}

export const PERMISSION_CARDS: PermissionCardConfig[] = [
  {
    field: "feed_post_roles",
    title: "Feed Posts",
    subtitle: "Who can create feed posts?",
    defaultRoles: ["admin", "active_member", "alumni"],
  },
  {
    field: "discussion_post_roles",
    title: "Discussion Posts",
    subtitle: "Who can start discussions?",
    defaultRoles: ["admin", "active_member", "alumni"],
  },
  {
    field: "job_post_roles",
    title: "Job Posts",
    subtitle: "Who can post job listings?",
    defaultRoles: ["admin", "alumni"],
  },
  {
    field: "media_upload_roles",
    title: "Media Uploads",
    subtitle: "Who can upload photos and videos?",
    defaultRoles: ["admin"],
  },
];

export const PERMISSION_ROLE_OPTIONS = [
  { value: "admin", label: "Admin", locked: true },
  { value: "active_member", label: "Active Members", locked: false },
  { value: "alumni", label: "Alumni", locked: false },
  { value: "parent", label: "Parents", locked: false },
] as const;

// Hex color validation
export const HEX_COLOR_REGEX = /^#[0-9A-Fa-f]{6}$/;
