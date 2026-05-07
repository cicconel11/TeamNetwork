"use client";

import type { OrgRole } from "@/lib/auth/role-utils";

interface NavItem {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  roles: OrgRole[];
}

interface NavConfig {
  [path: string]: {
    hidden?: boolean;
    hiddenForRoles?: OrgRole[];
  };
}

interface NavPreviewPanelProps {
  navItems: NavItem[];
  navConfig: NavConfig;
  selectedRole: OrgRole;
  onRoleChange: (role: OrgRole) => void;
}

export function NavPreviewPanel({
  navItems,
  navConfig,
  selectedRole,
  onRoleChange,
}: NavPreviewPanelProps) {
  const roles: { value: OrgRole; label: string }[] = [
    { value: "admin", label: "Admin" },
    { value: "active_member", label: "Active Member" },
    { value: "alumni", label: "Alumni" },
  ];

  const isItemVisible = (item: NavItem): boolean => {
    // Check if role has access to this item by default
    if (!item.roles.includes(selectedRole)) return false;

    const config = navConfig[item.href];
    if (!config) return true;

    // Check if completely hidden
    if (config.hidden) return false;

    // Check if hidden for this role
    if (config.hiddenForRoles?.includes(selectedRole)) return false;

    return true;
  };

  const visibleItems = navItems.filter(isItemVisible);

  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      {/* Preview Header */}
      <div className="p-4 border-b border-border bg-muted/30">
        <h3 className="font-medium text-foreground mb-3">Sidebar Preview</h3>
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">View as:</span>
          {roles.map((role) => (
            <button
              key={role.value}
              onClick={() => onRoleChange(role.value)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                selectedRole === role.value
                  ? "bg-purple-600 text-white"
                  : "bg-muted text-muted-foreground hover:text-foreground"
              }`}
            >
              {role.label}
            </button>
          ))}
        </div>
      </div>

      {/* Mock Sidebar */}
      <div className="bg-card p-4 min-h-[400px]">
        {/* Mock Org Header */}
        <div className="flex items-center gap-3 mb-6 pb-4 border-b border-border">
          <div className="h-10 w-10 rounded-xl bg-purple-600 flex items-center justify-center text-white font-bold">
            O
          </div>
          <div>
            <p className="font-semibold text-foreground">Organization</p>
            <p className="text-xs text-muted-foreground">{selectedRole}</p>
          </div>
        </div>

        {/* Nav Items */}
        <div className="space-y-1">
          {visibleItems.map((item) => {
            const Icon = item.icon;
            return (
              <div
                key={item.href}
                className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-muted-foreground hover:bg-muted/50"
              >
                <Icon className="h-5 w-5 flex-shrink-0" />
                {item.label}
              </div>
            );
          })}
        </div>

        {visibleItems.length === 0 && (
          <p className="text-sm text-muted-foreground text-center py-8">
            No visible items for this role
          </p>
        )}
      </div>

      {/* Footer */}
      <div className="p-3 border-t border-border bg-muted/20 text-center">
        <p className="text-xs text-muted-foreground">
          {visibleItems.length} of {navItems.length} items visible
        </p>
      </div>
    </div>
  );
}
