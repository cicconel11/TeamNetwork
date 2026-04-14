"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import type { Organization } from "@/types/database";
import type { OrgRole } from "@/lib/auth/role-utils";
import { ORG_NAV_ITEMS, ORG_NAV_GROUPS, type NavConfig, type NavGroupId, GridIcon, LogOutIcon, getConfigKey } from "@/lib/navigation/nav-items";
import { bucketItemsByGroup, buildSectionOrder, buildGlobalIndexMap, getActiveGroup, type VisibleNavItem } from "@/lib/navigation/sidebar-groups";
import { NavGroupSection, NavItemLink } from "@/components/layout/NavGroupSection";
import { HoverSidebar, PinButton } from "@/components/layout/HoverSidebar";
import { useUIProfile } from "@/lib/analytics/use-ui-profile";
import { Avatar } from "@/components/ui/Avatar";
import { Badge } from "@/components/ui/Badge";
import { getRoleLabel } from "@/lib/auth/role-display";


interface OrgSidebarProps {
  organization: Organization;
  role: OrgRole | null;
  isDevAdmin?: boolean;
  hasAlumniAccess?: boolean;
  hasParentsAccess?: boolean;
  currentProfileHref?: string;
  currentProfileName?: string;
  currentProfileAvatar?: string | null;
  pendingApprovalsCount?: number;
  className?: string;
  onClose?: () => void;
  forceExpanded?: boolean;
  layout?: "fixed" | "static";
}

export function OrgSidebar({ organization, role, isDevAdmin = false, hasAlumniAccess = false, hasParentsAccess = false, currentProfileHref, currentProfileName, currentProfileAvatar, pendingApprovalsCount, className = "", onClose, forceExpanded = false, layout = "fixed" }: OrgSidebarProps) {
  const pathname = usePathname();
  const basePath = `/${organization.slug}`;
  const { profile } = useUIProfile();
  const locale = useLocale();
  const tNav = useTranslations("nav");
  const tSidebar = useTranslations("sidebar");
  const tAuth = useTranslations("auth");

  const [openGroups, setOpenGroups] = useState<Set<NavGroupId>>(new Set());

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
      const translatedLabel = tNav(`items.${item.i18nKey}`);
      const customLabel = config?.label?.trim();
      const effectiveLabel = locale === "en"
        ? (customLabel || translatedLabel)
        : (translatedLabel || customLabel || item.label);
      return {
        ...item,
        label: effectiveLabel.slice(0, 80),
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
    }), [role, hasAlumniAccess, hasParentsAccess, navConfig, profile, tNav, locale]);

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

  const { sections, globalIndexMap } = useMemo(() => {
    const translatedGroups = ORG_NAV_GROUPS.map(g => ({
      ...g,
      label: tNav(`groups.${g.i18nKey}`),
    }));
    const b = bucketItemsByGroup(visibleNav);
    const s = buildSectionOrder(b, translatedGroups);
    const g = buildGlobalIndexMap(visibleNav);
    return { sections: s, globalIndexMap: g };
  }, [visibleNav, tNav]);

  const badgeCounts = useMemo<Record<string, number>>(() => {
    const counts: Record<string, number> = {};
    if (pendingApprovalsCount && pendingApprovalsCount > 0) {
      counts["/settings/approvals"] = pendingApprovalsCount;
    }
    return counts;
  }, [pendingApprovalsCount]);

  return (
    <HoverSidebar
      storageKey="sidebar-pinned-org"
      forceExpanded={forceExpanded}
      layout={layout}
      className={className}
    >
      {({ isExpanded, isPinned, togglePin }) => {
        const isCollapsed = !isExpanded;
        return (
          <>
            {/* Logo/Org Header */}
            <div className="flex items-stretch border-b border-border">
              <Link href={basePath} className="flex flex-1 min-w-0 items-center gap-3 py-4 pl-4">
                {organization.logo_url ? (
                  <div className="relative h-8 w-8 flex-shrink-0 rounded-xl overflow-hidden">
                    <Image
                      src={organization.logo_url}
                      alt={organization.name}
                      fill
                      className="object-cover"
                      sizes="32px"
                    />
                  </div>
                ) : (
                  <div
                    className="h-8 w-8 flex-shrink-0 rounded-xl flex items-center justify-center text-white font-bold"
                    style={{ backgroundColor: "var(--color-org-primary)" }}
                  >
                    {organization.name.charAt(0)}
                  </div>
                )}
                <div
                  className={`flex-1 min-w-0 transition-opacity duration-200 motion-reduce:transition-none ${
                    isCollapsed ? "opacity-0" : "opacity-100"
                  }`}
                  aria-hidden={isCollapsed || undefined}
                >
                  <h2 className="font-semibold text-foreground text-sm leading-tight break-words">{organization.name}</h2>
                  <p className="text-xs text-muted-foreground">TeamNetwork</p>
                  {isDevAdmin && (
                    <p className="text-[10px] uppercase tracking-wide text-purple-300 mt-1">Dev Admin</p>
                  )}
                </div>
              </Link>
              {!forceExpanded && (
                <div className="flex items-start pt-2 pr-2 flex-shrink-0">
                  <PinButton
                    isPinned={isPinned}
                    isExpanded={isExpanded}
                    onToggle={togglePin}
                  />
                </div>
              )}
            </div>

            {/* Profile Card — hidden when collapsed */}
            {currentProfileHref && currentProfileName && !isCollapsed && (
              <div className="px-4 pt-3 pb-3 border-b border-border">
                <Link
                  href={currentProfileHref}
                  className="flex items-center gap-3 p-2.5 rounded-xl hover:bg-muted/50 transition-all duration-200"
                >
                  <Avatar src={currentProfileAvatar} name={currentProfileName} size="md" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-foreground truncate">{currentProfileName}</p>
                    <Badge variant="muted" className="text-[11px] capitalize mt-0.5">
                      {role ? getRoleLabel(role) : "Profile"}
                    </Badge>
                  </div>
                </Link>
              </div>
            )}

            {/* Navigation */}
            <nav className="flex-1 overflow-y-auto overflow-x-hidden p-2">
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
                          badgeCounts={badgeCounts}
                          isCollapsed={isCollapsed}
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
                        badgeCounts={badgeCounts}
                        isCollapsed={isCollapsed}
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
                            badgeCounts={badgeCounts}
                            isCollapsed={isCollapsed}
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
            <div className="p-2 border-t border-border space-y-1">
              <Link
                href="/app"
                title={isCollapsed ? tSidebar("switchOrg") : undefined}
                aria-label={isCollapsed ? tSidebar("switchOrg") : undefined}
                className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground transition-[background-color,color] duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
              >
                <GridIcon className="h-5 w-5 flex-shrink-0" />
                <span
                  aria-hidden={isCollapsed || undefined}
                  className={`whitespace-nowrap transition-opacity duration-200 motion-reduce:transition-none ${
                    isCollapsed ? "opacity-0" : "opacity-100"
                  }`}
                >
                  {tSidebar("switchOrg")}
                </span>
              </Link>

              <form action="/auth/signout" method="POST">
                <button
                  type="submit"
                  title={isCollapsed ? tAuth("signOut") : undefined}
                  aria-label={isCollapsed ? tAuth("signOut") : undefined}
                  className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground transition-[background-color,color] duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
                >
                  <LogOutIcon className="h-5 w-5 flex-shrink-0" />
                  <span
                    aria-hidden={isCollapsed || undefined}
                    className={`whitespace-nowrap transition-opacity duration-200 motion-reduce:transition-none ${
                      isCollapsed ? "opacity-0" : "opacity-100"
                    }`}
                  >
                    {tAuth("signOut")}
                  </span>
                </button>
              </form>
            </div>

            {/* Platform Branding — hidden when collapsed */}
            {!isCollapsed && (
              <div className="px-4 py-4 border-t border-border">
                <Link href="/" className="flex flex-col items-start gap-1 group">
                  <span className="text-[10px] uppercase tracking-widest text-muted-foreground/50 group-hover:text-muted-foreground/80 transition-colors">
                    {tSidebar("poweredBy")}
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
            )}
          </>
        );
      }}
    </HoverSidebar>
  );
}
