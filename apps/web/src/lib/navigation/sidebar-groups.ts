/* eslint-disable @typescript-eslint/no-unused-vars */
import type { ComponentType } from "react";
import type { NavGroupId, NavGroup, OrgNavItem } from "./nav-items";

export type VisibleNavItem = OrgNavItem & { label: string; order?: number };

export type SidebarSection =
  | { type: "dashboard"; item: VisibleNavItem }
  | { type: "group"; group: NavGroup; items: VisibleNavItem[] }
  | { type: "standalone"; items: VisibleNavItem[] }
  | { type: "divider" };

export function bucketItemsByGroup(
  items: VisibleNavItem[]
): Map<NavGroupId | "standalone" | "dashboard", VisibleNavItem[]> {
  const buckets = new Map<NavGroupId | "standalone" | "dashboard", VisibleNavItem[]>();
  for (const item of items) {
    const key: NavGroupId | "standalone" | "dashboard" =
      item.href === "" ? "dashboard" : item.group ?? "standalone";
    const bucket = buckets.get(key);
    if (bucket) {
      bucket.push(item);
    } else {
      buckets.set(key, [item]);
    }
  }
  return buckets;
}

export function getActiveGroup(
  pathname: string,
  basePath: string,
  items: VisibleNavItem[]
): NavGroupId | null {
  for (const item of items) {
    if (!item.group) continue;
    if (item.href === "") continue;
    const href = `${basePath}${item.href}`;
    if (pathname === href || pathname.startsWith(href + "/")) {
      return item.group;
    }
  }
  return null;
}

export function buildSectionOrder(
  buckets: Map<NavGroupId | "standalone" | "dashboard", VisibleNavItem[]>,
  groups: NavGroup[]
): SidebarSection[] {
  const sections: SidebarSection[] = [];

  // 1. Dashboard (standalone, top)
  const dashboardItems = buckets.get("dashboard");
  if (dashboardItems && dashboardItems.length > 0) {
    sections.push({ type: "dashboard", item: dashboardItems[0] });
  }

  // 2. Each non-admin group in definition order
  for (const group of groups) {
    if (group.id === "admin") continue;
    const items = buckets.get(group.id);
    if (items && items.length > 0) {
      sections.push({ type: "group", group, items });
    }
  }

  // 3. Standalone middle items (no group, non-Dashboard)
  const standaloneItems = buckets.get("standalone");
  if (standaloneItems && standaloneItems.length > 0) {
    sections.push({ type: "standalone", items: standaloneItems });
  }

  // 4. Admin group (always last, only if it has items)
  const adminGroup = groups.find((g) => g.id === "admin");
  const adminItems = buckets.get("admin");
  if (adminGroup && adminItems && adminItems.length > 0) {
    sections.push({ type: "divider" });
    sections.push({ type: "group", group: adminGroup, items: adminItems });
  }

  return sections;
}

export function buildGlobalIndexMap(items: VisibleNavItem[]): Map<string, number> {
  const map = new Map<string, number>();
  items.forEach((item, index) => {
    map.set(item.href, index);
  });
  return map;
}
