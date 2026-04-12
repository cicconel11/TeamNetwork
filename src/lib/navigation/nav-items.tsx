/* eslint-disable @typescript-eslint/no-unused-vars */
import type { ComponentType } from "react";
import type { OrgRole } from "@/lib/auth/role-utils";
import {
  HomeIcon,
  GridIcon,
  UsersIcon,
  ChatIcon,
  GraduationCapIcon,
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
  ShieldCheckIcon,
} from "@/components/icons/nav-icons";

export type NavGroupId = "people" | "community" | "activity" | "finance" | "admin";

export type NavGroup = {
  id: NavGroupId;
  label: string;
  /** Translation key under nav.groups (e.g. "people") */
  i18nKey: NavGroupId;
};

export const ORG_NAV_GROUPS: NavGroup[] = [
  { id: "people", label: "People", i18nKey: "people" },
  { id: "community", label: "Community", i18nKey: "community" },
  { id: "activity", label: "Activity", i18nKey: "activity" },
  { id: "finance", label: "Finance", i18nKey: "finance" },
  { id: "admin", label: "Admin", i18nKey: "admin" },
];

export type OrgNavItem = {
  href: string;
  label: string;
  /** Translation key under nav.items (e.g. "home", "members") */
  i18nKey: string;
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
  { href: "", label: "Home", i18nKey: "home", icon: HomeIcon, roles: ["admin", "active_member", "alumni", "parent"] },
  { href: "/members", label: "Members", i18nKey: "members", icon: UsersIcon, roles: ["admin", "active_member", "alumni", "parent"], group: "people" },
  { href: "/messages", label: "Messages", i18nKey: "messages", icon: ChatIcon, roles: ["admin", "active_member", "alumni", "parent"], group: "community" },
  { href: "/alumni", label: "Alumni", i18nKey: "alumni", icon: GraduationCapIcon, roles: ["admin", "active_member", "alumni", "parent"], requiresAlumni: true, group: "people" },
  { href: "/parents", label: "Parents", i18nKey: "parents", icon: ParentsIcon, roles: ["admin", "active_member", "parent"], requiresParents: true, group: "people" },
  { href: "/mentorship", label: "Mentorship", i18nKey: "mentorship", icon: HandshakeIcon, roles: ["admin", "active_member", "alumni", "parent"], group: "people" },
  { href: "/workouts", label: "Workouts", i18nKey: "workouts", icon: DumbbellIcon, roles: ["admin", "active_member", "alumni", "parent"], group: "activity" },
  { href: "/competition", label: "Competition", i18nKey: "competition", icon: AwardIcon, roles: ["admin", "active_member", "alumni", "parent"], group: "activity" },
  { href: "/announcements", label: "Announcements", i18nKey: "announcements", icon: MegaphoneIcon, roles: ["admin", "active_member", "alumni", "parent"], group: "community" },
  { href: "/philanthropy", label: "Philanthropy", i18nKey: "philanthropy", icon: HeartIcon, roles: ["admin", "active_member", "alumni", "parent"], group: "finance" },
  { href: "/donations", label: "Donations", i18nKey: "donations", icon: DollarIcon, roles: ["admin", "active_member", "alumni", "parent"], group: "finance" },
  { href: "/expenses", label: "Expenses", i18nKey: "expenses", icon: ReceiptIcon, roles: ["admin", "active_member"], group: "finance" },
  { href: "/records", label: "Records", i18nKey: "records", icon: TrophyIcon, roles: ["admin", "active_member", "alumni", "parent"], group: "activity" },
  { href: "/calendar", label: "Calendar", i18nKey: "calendar", icon: BookOpenIcon, roles: ["admin", "active_member", "alumni", "parent"] },
  { href: "/jobs", label: "Jobs", i18nKey: "jobs", icon: BriefcaseIcon, roles: ["admin", "active_member", "alumni", "parent"], group: "community" },
  { href: "/forms", label: "Forms", i18nKey: "forms", icon: ClipboardIcon, roles: ["admin", "active_member", "alumni", "parent"], group: "community" },
  { href: "/media", label: "Media", i18nKey: "media", icon: GridIcon, roles: ["admin", "active_member", "alumni", "parent"], group: "community" },
  { href: "/customization", label: "Customization", i18nKey: "customization", icon: SettingsIcon, roles: ["admin", "active_member", "alumni", "parent"], configurable: false, group: "admin" },
  { href: "/settings/approvals", label: "Approvals", i18nKey: "approvals", icon: ShieldCheckIcon, roles: ["admin"], configurable: false, group: "admin" },
  { href: "/settings/invites", label: "Settings", i18nKey: "settings", icon: InviteIcon, roles: ["admin"], group: "admin" },
  { href: "/settings/navigation", label: "Navigation", i18nKey: "navigation", icon: SettingsIcon, roles: ["admin"], configurable: false, group: "admin" },
];

export { GridIcon, InviteIcon, LogOutIcon, ParentsIcon } from "@/components/icons/nav-icons";
