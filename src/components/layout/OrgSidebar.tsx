"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import type { Organization } from "@/types/database";
import type { OrgRole } from "@/lib/auth/role-utils";
import { ORG_NAV_ITEMS, type NavConfig, GridIcon, LogOutIcon } from "@/lib/navigation/nav-items";

interface OrgSidebarProps {
  organization: Organization;
  role: OrgRole | null;
  className?: string;
  onClose?: () => void;
}

export function OrgSidebar({ organization, role, className = "", onClose }: OrgSidebarProps) {
  const pathname = usePathname();
  const basePath = `/${organization.slug}`;
  
  // Parse nav_config
  const navConfig = (organization.nav_config && typeof organization.nav_config === "object" && !Array.isArray(organization.nav_config)
    ? (organization.nav_config as NavConfig)
    : {}) || {};

  const visibleNav = ORG_NAV_ITEMS
    .filter((item) => {
      // Role check
      if (role && !item.roles.includes(role)) return false;
      
      // Config check (hide if hidden is true)
      const config = navConfig[item.href];
      if (config?.hidden) return false;
      if (role && Array.isArray(config?.hiddenForRoles) && config.hiddenForRoles.includes(role)) return false;
      
      return true;
    })
    .map((item) => {
      const config = navConfig[item.href];
      return {
        ...item,
        label: config?.label?.trim() || item.label,
      };
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
              style={{ backgroundColor: organization.primary_color || "var(--color-org-primary)" }}
            >
              {organization.name.charAt(0)}
            </div>
          )}
          <div className="flex-1 min-w-0">
            <h2 className="font-semibold text-foreground truncate">{organization.name}</h2>
            <p className="text-xs text-muted-foreground">TeamNetwork</p>
          </div>
        </Link>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto p-4">
        <ul className="space-y-1">
          {visibleNav.map((item) => {
            const href = `${basePath}${item.href}`;
            const isActive = pathname === href || (item.href !== "" && pathname.startsWith(href));
            const Icon = item.icon;

            return (
              <li key={item.href}>
                <Link
                  href={href}
                  onClick={onClose}
                  className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-200 ${isActive
                      ? "bg-org-primary text-white"
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
