"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import type { EnterpriseRole } from "@/types/enterprise";
import { getEnterprisePermissions } from "@/types/enterprise";

function HomeIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M2.25 12l8.954-8.955c.44-.439 1.152-.439 1.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75M8.25 21h8.25"
      />
    </svg>
  );
}

function BuildingIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M3.75 21h16.5M4.5 3h15M5.25 3v18m13.5-18v18M9 6.75h1.5m-1.5 3h1.5m-1.5 3h1.5m3-6H15m-1.5 3H15m-1.5 3H15M9 21v-3.375c0-.621.504-1.125 1.125-1.125h3.75c.621 0 1.125.504 1.125 1.125V21"
      />
    </svg>
  );
}

function CreditCardIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M2.25 8.25h19.5M2.25 9h19.5m-16.5 5.25h6m-6 2.25h3m-3.75 3h15a2.25 2.25 0 002.25-2.25V6.75A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25v10.5A2.25 2.25 0 004.5 19.5z"
      />
    </svg>
  );
}

function SettingsIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M9.594 3.938a1.5 1.5 0 012.812 0l.316.949a1.5 1.5 0 002.02.948l.93-.34a1.5 1.5 0 011.882.82l.012.03a1.5 1.5 0 01-.534 1.83l-.805.584a1.5 1.5 0 000 2.45l.805.584a1.5 1.5 0 01.522 1.84l-.014.03a1.5 1.5 0 01-1.882.82l-.93-.34a1.5 1.5 0 00-2.02.948l-.316.949a1.5 1.5 0 01-2.812 0l-.316-.949a1.5 1.5 0 00-2.02-.948l-.93.34a1.5 1.5 0 01-1.882-.82l-.012-.03a1.5 1.5 0 01.534-1.83l.805-.584a1.5 1.5 0 000-2.45l-.805-.584a1.5 1.5 0 01-.522-1.84l.014-.03a1.5 1.5 0 011.882-.82l.93.34a1.5 1.5 0 002.02-.948l.316-.949z"
      />
      <path strokeLinecap="round" strokeLinejoin="round" d="M14.25 12a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0z" />
    </svg>
  );
}

function GridIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25v2.25A2.25 2.25 0 0118 20.25h-2.25a2.25 2.25 0 01-2.25-2.25v-2.25z"
      />
    </svg>
  );
}

function LogOutIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15M12 9l-3 3m0 0l3 3m-3-3h12.75"
      />
    </svg>
  );
}

function GraduationCapIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M4.26 10.147a60.436 60.436 0 00-.491 6.347A48.627 48.627 0 0112 20.904a48.627 48.627 0 018.232-4.41 60.46 60.46 0 00-.491-6.347m-15.482 0a50.57 50.57 0 00-2.658-.813A59.905 59.905 0 0112 3.493a59.902 59.902 0 0110.399 5.84c-.896.248-1.783.52-2.658.814m-15.482 0A50.697 50.697 0 0112 13.489a50.702 50.702 0 017.74-3.342M6.75 15a.75.75 0 100-1.5.75.75 0 000 1.5zm0 0v-3.675A55.378 55.378 0 0112 8.443m-7.007 11.55A5.981 5.981 0 006.75 15.75v-1.5"
      />
    </svg>
  );
}

function UserPlusIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M18 7.5v3m0 0v3m0-3h3m-3 0h-3m-2.25-4.125a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zM3 19.235v-.11a6.375 6.375 0 0112.75 0v.109A12.318 12.318 0 019.374 21c-2.331 0-4.512-.645-6.374-1.766z"
      />
    </svg>
  );
}

function LayoutIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25a2.25 2.25 0 01-2.25-2.25v-2.25z"
      />
    </svg>
  );
}

interface EnterpriseSidebarProps {
  enterpriseSlug: string;
  enterpriseName: string;
  logoUrl?: string | null;
  role: EnterpriseRole;
  className?: string;
  onClose?: () => void;
}

interface NavItem {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  requiresBilling?: boolean;
}

const NAV_ITEMS: NavItem[] = [
  { href: "", label: "Dashboard", icon: HomeIcon },
  { href: "/organizations", label: "Organizations", icon: BuildingIcon },
  { href: "/alumni", label: "Alumni", icon: GraduationCapIcon },
  { href: "/invites", label: "Invites", icon: UserPlusIcon },
  { href: "/navigation", label: "Navigation", icon: LayoutIcon },
  { href: "/billing", label: "Billing", icon: CreditCardIcon, requiresBilling: true },
  { href: "/settings", label: "Settings", icon: SettingsIcon },
];

export function EnterpriseSidebar({
  enterpriseSlug,
  enterpriseName,
  logoUrl,
  role,
  className = "",
  onClose,
}: EnterpriseSidebarProps) {
  const pathname = usePathname();
  const basePath = `/enterprise/${enterpriseSlug}`;
  const permissions = getEnterprisePermissions(role);

  const visibleNav = NAV_ITEMS.filter((item) => {
    if (item.requiresBilling && !permissions.canManageBilling) {
      return false;
    }
    return true;
  });

  return (
    <aside className={`flex flex-col bg-card border-r border-border h-full ${className}`}>
      {/* Logo/Enterprise Header */}
      <div className="p-6 border-b border-border">
        <Link href={basePath} className="flex items-center gap-3">
          {logoUrl ? (
            <div className="relative h-10 w-10 rounded-xl overflow-hidden">
              <Image
                src={logoUrl}
                alt={enterpriseName}
                fill
                className="object-cover"
                sizes="40px"
              />
            </div>
          ) : (
            <div className="h-10 w-10 rounded-xl flex items-center justify-center bg-purple-600 text-white font-bold text-lg">
              {enterpriseName.charAt(0)}
            </div>
          )}
          <div className="flex-1 min-w-0">
            <h2 className="font-semibold text-foreground truncate">{enterpriseName}</h2>
            <p className="text-xs text-muted-foreground">Enterprise</p>
          </div>
        </Link>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto p-4">
        <ul className="space-y-1">
          {visibleNav.map((item) => {
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

            return (
              <li key={item.href || "dashboard"}>
                <Link
                  href={href}
                  onClick={onClose}
                  className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-200 ${
                    isActive
                      ? "bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 shadow-soft"
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
          Back to App
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
