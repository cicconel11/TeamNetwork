"use client";

import Link from "next/link";
import type { NavGroup } from "@/lib/navigation/nav-items";
import type { VisibleNavItem } from "@/lib/navigation/sidebar-groups";
import { trackBehavioralEvent } from "@/lib/analytics/events";

interface NavGroupSectionProps {
  group: NavGroup;
  items: VisibleNavItem[];
  isOpen: boolean;
  onToggle: () => void;
  basePath: string;
  pathname: string;
  visibleNav: VisibleNavItem[];
  organizationId: string;
  globalIndexMap: Map<string, number>;
  onClose?: () => void;
  badgeCounts?: Record<string, number>;
  isCollapsed?: boolean;
}

export function NavGroupSection({
  group,
  items,
  isOpen,
  onToggle,
  basePath,
  pathname,
  visibleNav,
  organizationId,
  globalIndexMap,
  onClose,
  badgeCounts,
  isCollapsed = false,
}: NavGroupSectionProps) {
  const panelId = `nav-group-${group.id}`;

  if (isCollapsed) {
    return (
      <ul className="flex flex-col items-center gap-1">
        {items.map((item) => (
          <NavItemLink
            key={item.href}
            item={item}
            basePath={basePath}
            pathname={pathname}
            visibleNav={visibleNav}
            organizationId={organizationId}
            globalIndex={globalIndexMap.get(item.href) ?? 0}
            onClose={onClose}
            badgeCounts={badgeCounts}
            isCollapsed
          />
        ))}
      </ul>
    );
  }

  return (
    <div>
      <button
        aria-expanded={isOpen}
        aria-controls={panelId}
        onClick={onToggle}
        className="w-full flex items-center justify-between px-3 py-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider hover:text-foreground transition-colors duration-200 rounded-lg hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
      >
        {group.label}
        <svg
          aria-hidden="true"
          className={`h-3.5 w-3.5 transition-transform duration-200 motion-reduce:transition-none ${isOpen ? "rotate-180" : ""}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
        </svg>
      </button>

      <div
        id={panelId}
        aria-hidden={!isOpen}
        {...(!isOpen ? { inert: "" as unknown as boolean } : {})}
        className="grid transition-[grid-template-rows] duration-200 ease-in-out motion-reduce:transition-none"
        style={{ gridTemplateRows: isOpen ? "1fr" : "0fr" }}
      >
        <div className="overflow-hidden">
          <ul className="space-y-0.5 pt-0.5 pb-1">
            {items.map((item) => (
              <NavItemLink
                key={item.href}
                item={item}
                basePath={basePath}
                pathname={pathname}
                visibleNav={visibleNav}
                organizationId={organizationId}
                globalIndex={globalIndexMap.get(item.href) ?? 0}
                onClose={onClose}
                badgeCounts={badgeCounts}
              />
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

interface NavItemLinkProps {
  item: VisibleNavItem;
  basePath: string;
  pathname: string;
  visibleNav: VisibleNavItem[];
  organizationId: string;
  globalIndex: number;
  onClose?: () => void;
  badgeCounts?: Record<string, number>;
  isCollapsed?: boolean;
}

export function NavItemLink({
  item,
  basePath,
  pathname,
  visibleNav,
  organizationId,
  globalIndex,
  onClose,
  badgeCounts,
  isCollapsed = false,
}: NavItemLinkProps) {
  const href = `${basePath}${item.href}`;
  let isActive = pathname === href;
  if (!isActive && item.href !== "") {
    const isPathMatch = pathname.startsWith(href + "/") || pathname === href;
    const hasMoreSpecificMatch = visibleNav.some(
      (other) =>
        other.href !== item.href &&
        other.href.startsWith(item.href + "/") &&
        pathname.startsWith(`${basePath}${other.href}`)
    );
    isActive = isPathMatch && !hasMoreSpecificMatch;
  }
  const Icon = item.icon;
  const badgeCount = badgeCounts?.[item.href];
  const hasBadge = badgeCount != null && badgeCount > 0;

  return (
    <li className={isCollapsed ? "w-full flex justify-center" : ""}>
      <Link
        href={href}
        title={isCollapsed ? item.label : undefined}
        aria-label={isCollapsed ? item.label : undefined}
        onClick={() => {
          trackBehavioralEvent(
            "nav_click",
            {
              destination_route: href,
              nav_surface: "sidebar",
              position: globalIndex,
            },
            organizationId
          );
          onClose?.();
        }}
        className={`flex items-center text-sm font-medium transition-[background-color,color,box-shadow] duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 ${
          isCollapsed
            ? "justify-center w-10 h-10 rounded-xl"
            : "gap-3 px-3 py-2.5 rounded-xl"
        } ${
          isActive
            ? "bg-org-secondary text-org-secondary-foreground shadow-soft"
            : "text-muted-foreground hover:bg-muted hover:text-foreground"
        }`}
      >
        <Icon className="h-5 w-5 flex-shrink-0" />
        {!isCollapsed && (
          <>
            <span className="whitespace-nowrap">{item.label}</span>
            {hasBadge && (
              <span className="ml-auto inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 text-[10px] font-bold rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
                {badgeCount}
              </span>
            )}
          </>
        )}
      </Link>
    </li>
  );
}
