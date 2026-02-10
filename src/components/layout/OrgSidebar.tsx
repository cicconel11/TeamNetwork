"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import type { Organization } from "@/types/database";
import type { OrgRole } from "@/lib/auth/role-utils";
import { ORG_NAV_ITEMS, type NavConfig, GridIcon, LogOutIcon } from "@/lib/navigation/nav-items";
import { ThemeToggle } from "@/components/theme/ThemeToggle";
import { useUIProfile } from "@/lib/analytics/use-ui-profile";
import { trackBehavioralEvent } from "@/lib/analytics/events";

interface OrgSidebarProps {
  organization: Organization;
  role: OrgRole | null;
  isDevAdmin?: boolean;
  className?: string;
  onClose?: () => void;
}

export function OrgSidebar({ organization, role, isDevAdmin = false, className = "", onClose }: OrgSidebarProps) {
  const pathname = usePathname();
  const basePath = `/${organization.slug}`;
  const { profile } = useUIProfile(organization.id);
  
  // Parse nav_config
  const navConfig = (organization.nav_config && typeof organization.nav_config === "object" && !Array.isArray(organization.nav_config)
    ? (organization.nav_config as NavConfig)
    : {}) || {};

  // Helper to get config key - Dashboard has empty href, so use "dashboard" as key
  const getConfigKey = (href: string) => href === "" ? "dashboard" : href;

  const visibleNav = ORG_NAV_ITEMS
    .filter((item) => {
      // Role check
      if (role && !item.roles.includes(role)) return false;
      
      // Config check (hide if hidden is true)
      const configKey = getConfigKey(item.href);
      const config = navConfig[configKey];
      if (config?.hidden) return false;
      if (role && Array.isArray(config?.hiddenForRoles) && config.hiddenForRoles.includes(role)) return false;
      
      return true;
    })
    .map((item) => {
      const configKey = getConfigKey(item.href);
      const config = navConfig[configKey];
      return {
        ...item,
        label: config?.label?.trim() || item.label,
        order: config?.order,
      };
    })
    .sort((a, b) => {
      // If both have explicit orders from nav_config, compare them
      if (a.order !== undefined && b.order !== undefined) {
        return a.order - b.order;
      }
      // If only one has an explicit order, it comes first
      if (a.order !== undefined) return -1;
      if (b.order !== undefined) return 1;

      // Fall back to LLM-generated profile nav_order (if available)
      if (profile?.nav_order && profile.nav_order.length > 0) {
        const aKey = a.href === "" ? "dashboard" : a.href.replace(/^\//, "");
        const bKey = b.href === "" ? "dashboard" : b.href.replace(/^\//, "");
        const aIdx = profile.nav_order.indexOf(aKey);
        const bIdx = profile.nav_order.indexOf(bKey);
        // Both in profile → sort by profile order
        if (aIdx >= 0 && bIdx >= 0) return aIdx - bIdx;
        // Only one in profile → it comes first
        if (aIdx >= 0) return -1;
        if (bIdx >= 0) return 1;
      }

      // Default position from ORG_NAV_ITEMS
      return ORG_NAV_ITEMS.findIndex(i => i.href === a.href) - ORG_NAV_ITEMS.findIndex(i => i.href === b.href);
    });

  return (
    <aside className={`flex flex-col bg-card border-r border-border h-full ${className}`}>
      {/* Logo/Org Header */}
      <div className="p-6 border-b border-border">
        <Link href={basePath} className="flex items-center gap-3">
          {organization.logo_url ? (
            <div className="relative h-10 w-10 rounded-xl overflow-hidden">
              <Image
                src={organization.logo_url}
                alt={organization.name}
                fill
                className="object-cover"
                sizes="40px"
              />
            </div>
          ) : (
            <div
              className="h-10 w-10 rounded-xl flex items-center justify-center text-white font-bold text-lg"
              style={{ backgroundColor: "var(--color-org-primary)" }}
            >
              {organization.name.charAt(0)}
            </div>
          )}
          <div className="flex-1 min-w-0">
            <h2 className="font-semibold text-foreground truncate">{organization.name}</h2>
            <p className="text-xs text-muted-foreground">TeamNetwork</p>
            {isDevAdmin && (
              <p className="text-[10px] uppercase tracking-wide text-purple-300 mt-1">Dev Admin</p>
            )}
          </div>
        </Link>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto p-4">
        <ul className="space-y-1">
          {visibleNav.map((item, index) => {
            const href = `${basePath}${item.href}`;
            // Check for exact match first
            let isActive = pathname === href;
            // For non-root items, check if pathname starts with href
            // but only if there's no more specific nav item that matches
            if (!isActive && item.href !== "") {
              const isPathMatch = pathname.startsWith(href + "/") || pathname === href;
              // Ensure we don't highlight parent items when a child item should be active
              // e.g., don't highlight /settings when on /settings/invites
              const hasMoreSpecificMatch = visibleNav.some(
                (other) => other.href !== item.href && 
                           other.href.startsWith(item.href + "/") && 
                           pathname.startsWith(`${basePath}${other.href}`)
              );
              isActive = isPathMatch && !hasMoreSpecificMatch;
            }
            const Icon = item.icon;

            return (
              <li key={item.href}>
                <Link
                  href={href}
                  onClick={() => {
                    trackBehavioralEvent("nav_click", {
                      destination_route: href,
                      nav_surface: "sidebar",
                      position: index,
                    }, organization.id);
                    onClose?.();
                  }}
                  className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-200 ${
                    isActive
                      ? "bg-org-secondary text-org-secondary-foreground shadow-soft"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground"
                  }`}
                >
                  <Icon className="h-5 w-5 flex-shrink-0" />
                  {item.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      {/* User Section */}
      <div className="p-4 border-t border-border space-y-1">
        <div className="flex items-center justify-between px-3 py-2.5">
          <span className="text-sm font-medium text-muted-foreground">Theme</span>
          <ThemeToggle />
        </div>

        <Link
          href="/app"
          className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground transition-all duration-200"
        >
          <GridIcon className="h-5 w-5" />
          Switch Organization
        </Link>

        <form action="/auth/signout" method="POST">
          <button
            type="submit"
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground transition-all duration-200"
          >
            <LogOutIcon className="h-5 w-5" />
            Sign Out
          </button>
        </form>
      </div>
    </aside>
  );
}
