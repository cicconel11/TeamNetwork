/* eslint-disable @typescript-eslint/no-unused-vars */
import type { ComponentType } from "react";
import type { OrgRole } from "@/lib/auth/role-utils";
import {
  HomeIcon,
  GridIcon,
  UsersIcon,
  ChatIcon,
  GraduationCapIcon,
  CalendarIcon,
  MegaphoneIcon,
  HeartIcon,
  DollarIcon,
  ReceiptIcon,
  TrophyIcon,
  AwardIcon,
  HandshakeIcon,
  DumbbellIcon,
  LogOutIcon,
  InviteIcon,
  SettingsIcon,
  BookOpenIcon,
  ClipboardIcon,
  DiscussionIcon,
  BriefcaseIcon,
  FeedIcon,
  ParentsIcon,
} from "@/components/icons/nav-icons";

export type NavGroupId = "people" | "community" | "schedule" | "activity" | "finance" | "admin";

export type NavGroup = {
  id: NavGroupId;
  label: string;
};

export const ORG_NAV_GROUPS: NavGroup[] = [
  { id: "people", label: "People" },
  { id: "community", label: "Community" },
  { id: "schedule", label: "Schedule" },
  { id: "activity", label: "Activity" },
  { id: "finance", label: "Finance" },
  { id: "admin", label: "Admin" },
];

export type OrgNavItem = {
  href: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
  roles: OrgRole[];
  configurable?: boolean;
  requiresAlumni?: boolean;
  requiresParents?: boolean;
  group?: NavGroupId;
};

export type NavConfigEntry = {
  label?: string;
  hidden?: boolean;
  hiddenForRoles?: OrgRole[];
  editRoles?: OrgRole[];
  order?: number;
};

export type NavConfig = Record<string, NavConfigEntry>;

export const getConfigKey = (href: string): string => href === "" ? "dashboard" : href;

export const ORG_NAV_ITEMS: OrgNavItem[] = [
  { href: "", label: "Dashboard", icon: HomeIcon, roles: ["admin", "active_member", "alumni", "parent"] },
  { href: "/members", label: "Members", icon: UsersIcon, roles: ["admin", "active_member", "alumni", "parent"], group: "people" },
  { href: "/messages", label: "Messages", icon: ChatIcon, roles: ["admin", "active_member", "alumni", "parent"], group: "community" },
  { href: "/feed", label: "Feed", icon: FeedIcon, roles: ["admin", "active_member", "alumni", "parent"], group: "community" },
  { href: "/alumni", label: "Alumni", icon: GraduationCapIcon, roles: ["admin", "active_member", "alumni", "parent"], requiresAlumni: true, group: "people" },
  { href: "/parents", label: "Parents", icon: ParentsIcon, roles: ["admin", "active_member", "parent"], requiresParents: true, group: "people" },
  { href: "/mentorship", label: "Mentorship", icon: HandshakeIcon, roles: ["admin", "active_member", "alumni", "parent"], group: "people" },
  { href: "/workouts", label: "Workouts", icon: DumbbellIcon, roles: ["admin", "active_member", "alumni", "parent"], group: "activity" },
  { href: "/competition", label: "Competition", icon: AwardIcon, roles: ["admin", "active_member", "alumni", "parent"], group: "activity" },
  { href: "/events", label: "Events", icon: CalendarIcon, roles: ["admin", "active_member", "alumni", "parent"], group: "schedule" },
  { href: "/announcements", label: "Announcements", icon: MegaphoneIcon, roles: ["admin", "active_member", "alumni", "parent"], group: "community" },
  { href: "/philanthropy", label: "Philanthropy", icon: HeartIcon, roles: ["admin", "active_member", "alumni", "parent"], group: "finance" },
  { href: "/donations", label: "Donations", icon: DollarIcon, roles: ["admin", "active_member", "alumni", "parent"], group: "finance" },
  { href: "/expenses", label: "Expenses", icon: ReceiptIcon, roles: ["admin", "active_member"], group: "finance" },
  { href: "/records", label: "Records", icon: TrophyIcon, roles: ["admin", "active_member", "alumni", "parent"], group: "activity" },
  { href: "/calendar", label: "Calendar", icon: BookOpenIcon, roles: ["admin", "active_member", "alumni", "parent"], group: "schedule" },
  { href: "/jobs", label: "Jobs", icon: BriefcaseIcon, roles: ["admin", "active_member", "alumni", "parent"], group: "community" },
  { href: "/forms", label: "Forms", icon: ClipboardIcon, roles: ["admin", "active_member", "alumni", "parent"], group: "community" },
  { href: "/media", label: "Media Archive", icon: GridIcon, roles: ["admin", "active_member", "alumni", "parent"], group: "community" },
  { href: "/customization", label: "Customization", icon: SettingsIcon, roles: ["admin", "active_member", "alumni", "parent"], configurable: false, group: "admin" },
  { href: "/settings/invites", label: "Settings", icon: InviteIcon, roles: ["admin"], group: "admin" },
  { href: "/settings/navigation", label: "Navigation", icon: SettingsIcon, roles: ["admin"], configurable: false, group: "admin" },
];

export { GridIcon, InviteIcon, LogOutIcon, ParentsIcon } from "@/components/icons/nav-icons";
