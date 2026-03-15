"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import type { Organization } from "@teammeet/types";
import type { OrgRole } from "@/lib/auth/role-utils";
import { ORG_NAV_ITEMS, ORG_NAV_GROUPS, type NavConfig, type NavGroupId, GridIcon, LogOutIcon, getConfigKey } from "@/lib/navigation/nav-items";
import { bucketItemsByGroup, buildSectionOrder, buildGlobalIndexMap, getActiveGroup, type VisibleNavItem } from "@/lib/navigation/sidebar-groups";
import { NavGroupSection, NavItemLink } from "@/components/layout/NavGroupSection";
import { ThemeToggle } from "@/components/theme/ThemeToggle";
import { useUIProfile } from "@/lib/analytics/use-ui-profile";
import { Avatar } from "@/components/ui/Avatar";
import { Badge } from "@/components/ui/Badge";

interface OrgSidebarProps {
  organization: Organization;
  role: OrgRole | null;
  isDevAdmin?: boolean;
  hasAlumniAccess?: boolean;
  hasParentsAccess?: boolean;
  currentMemberId?: string;
  currentMemberName?: string;
  currentMemberAvatar?: string | null;
  className?: string;
  onClose?: () => void;
}

export function OrgSidebar({ organization, role, isDevAdmin = false, hasAlumniAccess = false, hasParentsAccess = false, currentMemberId, currentMemberName, currentMemberAvatar, className = "", onClose }: OrgSidebarProps) {
  const pathname = usePathname();
  const basePath = `/${organization.slug}`;
  const { profile } = useUIProfile();

  const [openGroups, setOpenGroups] = useState<Set<NavGroupId>>(new Set());

  // Parse nav_config with stable identity for hook dependencies
  const navConfig = useMemo<NavConfig>(() => {
    if (
      organization.nav_config &&
      typeof organization.nav_config === "object" &&
      !Array.isArray(organization.nav_config)
    ) {
      return organization.nav_config as NavConfig;
    }
    return {};
  }, [organization.nav_config]);

  const visibleNav: VisibleNavItem[] = useMemo(() => ORG_NAV_ITEMS
    .filter((item) => {
      if (role && !item.roles.includes(role)) return false;
      if (item.requiresAlumni && !hasAlumniAccess) return false;
      if (item.requiresParents && !hasParentsAccess) return false;
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
        label: (config?.label?.trim() || item.label).slice(0, 80),
        order: config?.order,
      };
    })
    .sort((a, b) => {
      if (a.order !== undefined && b.order !== undefined) return a.order - b.order;
      if (a.order !== undefined) return -1;
      if (b.order !== undefined) return 1;
      if (profile?.nav_order && profile.nav_order.length > 0) {
        const aKey = a.href === "" ? "dashboard" : a.href.replace(/^\//, "");
        const bKey = b.href === "" ? "dashboard" : b.href.replace(/^\//, "");
        const aIdx = profile.nav_order.indexOf(aKey);
        const bIdx = profile.nav_order.indexOf(bKey);
        if (aIdx >= 0 && bIdx >= 0) return aIdx - bIdx;
        if (aIdx >= 0) return -1;
        if (bIdx >= 0) return 1;
      }
      return ORG_NAV_ITEMS.findIndex(i => i.href === a.href) - ORG_NAV_ITEMS.findIndex(i => i.href === b.href);
    }), [role, hasAlumniAccess, hasParentsAccess, navConfig, profile]);

  // Auto-expand active group on navigation
  useEffect(() => {
    const activeGroupId = getActiveGroup(pathname, basePath, visibleNav);
    if (activeGroupId) {
      setOpenGroups(prev => {
        if (prev.has(activeGroupId)) return prev;
        return new Set([...prev, activeGroupId]);
      });
    }
  }, [pathname, basePath, visibleNav]);

  const toggleGroup = useCallback((groupId: NavGroupId) => {
    setOpenGroups(prev => {
      const next = new Set(prev);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      return next;
    });
  }, []);

  // Sort-then-bucket: bucket already-sorted items
  const { sections, globalIndexMap } = useMemo(() => {
    const b = bucketItemsByGroup(visibleNav);
    const s = buildSectionOrder(b, ORG_NAV_GROUPS);
    const g = buildGlobalIndexMap(visibleNav);
    return { sections: s, globalIndexMap: g };
  }, [visibleNav]);

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

      {/* Profile Card */}
      {currentMemberId && currentMemberName && (
        <div className="px-4 pt-3 pb-3 border-b border-border">
          <Link
            href={`${basePath}/members/${currentMemberId}`}
            className="flex items-center gap-3 p-2.5 rounded-xl hover:bg-muted/50 transition-all duration-200"
          >
            <Avatar src={currentMemberAvatar} name={currentMemberName} size="md" />
            <div className="min-w-0">
              <p className="text-sm font-semibold text-foreground truncate">{currentMemberName}</p>
              <Badge variant="muted" className="text-[11px] capitalize mt-0.5">
                {role === "active_member" ? "Member" : role}
              </Badge>
            </div>
          </Link>
        </div>
      )}

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto p-4">
        <div className="space-y-3">
          {sections.map((section, sectionIndex) => {
            if (section.type === "dashboard") {
              return (
                <ul key="dashboard">
                  <NavItemLink
                    item={section.item}
                    basePath={basePath}
                    pathname={pathname}
                    visibleNav={visibleNav}
                    organizationId={organization.id}
                    globalIndex={globalIndexMap.get(section.item.href) ?? 0}
                    onClose={onClose}
                  />
                </ul>
              );
            }
            if (section.type === "group") {
              return (
                <NavGroupSection
                  key={section.group.id}
                  group={section.group}
                  items={section.items}
                  isOpen={openGroups.has(section.group.id)}
                  onToggle={() => toggleGroup(section.group.id)}
                  basePath={basePath}
                  pathname={pathname}
                  visibleNav={visibleNav}
                  organizationId={organization.id}
                  globalIndexMap={globalIndexMap}
                  onClose={onClose}
                />
              );
            }
            if (section.type === "standalone") {
              return (
                <ul key="standalone" className="space-y-0.5">
                  {section.items.map((item) => (
                    <NavItemLink
                      key={item.href}
                      item={item}
                      basePath={basePath}
                      pathname={pathname}
                      visibleNav={visibleNav}
                      organizationId={organization.id}
                      globalIndex={globalIndexMap.get(item.href) ?? 0}
                      onClose={onClose}
                    />
                  ))}
                </ul>
              );
            }
            if (section.type === "divider") {
              return <hr key={`divider-${sectionIndex}`} className="border-border" />;
            }
            return null;
          })}
        </div>
      </nav>

      {/* User Section */}
      <div className="p-4 border-t border-border space-y-1">
        <div className="flex items-center justify-between px-3 py-2.5">
          <span className="text-sm font-medium text-muted-foreground">Theme</span>
          <ThemeToggle />
        </div>

        {currentMemberId && (
          <Link
            href={`${basePath}/members/${currentMemberId}`}
            className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground transition-[background-color,color] duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
          >
            <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="8" r="4" />
              <path d="M4 20c0-4 3.582-7 8-7s8 3 8 7" />
            </svg>
            My Profile
          </Link>
        )}

        <Link
          href="/app"
          className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground transition-[background-color,color] duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
        >
          <GridIcon className="h-5 w-5" />
          Switch Organization
        </Link>

        <form action="/auth/signout" method="POST">
          <button
            type="submit"
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground transition-[background-color,color] duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
          >
            <LogOutIcon className="h-5 w-5" />
            Sign Out
          </button>
        </form>
      </div>

      {/* Platform Branding */}
      <div className="px-4 py-4 border-t border-border">
        <Link href="/" className="flex flex-col items-start gap-1 group">
          <span className="text-[10px] uppercase tracking-widest text-muted-foreground/50 group-hover:text-muted-foreground/80 transition-colors">
            Powered by
          </span>
          <Image
            src="/TeamNetwor.png"
            alt="TeamNetwork"
            width={541}
            height={303}
            className="w-full max-w-[200px] h-auto object-contain opacity-50 group-hover:opacity-80 transition-opacity"
          />
        </Link>
      </div>
    </aside>
  );
}
