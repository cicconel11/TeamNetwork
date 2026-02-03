"use client";

import { Badge, Select } from "@/components/ui";
import type { OrgRole } from "@/lib/auth/role-utils";

interface NavItemRowProps {
  path: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  defaultRoles: OrgRole[];
  isHidden: boolean;
  hiddenForRoles: OrgRole[];
  isLocked: boolean;
  onToggleHidden: (hidden: boolean) => void;
  onToggleHiddenForRole: (role: OrgRole, hidden: boolean) => void;
  onToggleLocked: (locked: boolean) => void;
}

export function NavItemRow({
  label,
  icon: Icon,
  defaultRoles,
  isHidden,
  hiddenForRoles,
  isLocked,
  onToggleHidden,
  onToggleHiddenForRole,
  onToggleLocked,
}: NavItemRowProps) {
  const roleOptions: OrgRole[] = ["admin", "active_member", "alumni"];

  return (
    <div className={`flex items-center gap-4 p-4 rounded-xl border border-border ${isHidden ? "opacity-50 bg-muted/30" : "bg-card"}`}>
      {/* Icon and Label */}
      <div className="flex items-center gap-3 flex-1 min-w-0">
        <div className="h-10 w-10 rounded-xl bg-muted flex items-center justify-center flex-shrink-0">
          <Icon className="h-5 w-5 text-muted-foreground" />
        </div>
        <div className="min-w-0">
          <p className="font-medium text-foreground truncate">{label}</p>
          <div className="flex items-center gap-1.5 mt-1">
            {defaultRoles.map((role) => (
              <Badge key={role} variant="muted" className="text-[10px] px-1.5 py-0.5">
                {role === "active_member" ? "member" : role}
              </Badge>
            ))}
          </div>
        </div>
      </div>

      {/* Visibility Toggle */}
      <div className="flex items-center gap-2">
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={!isHidden}
            onChange={(e) => onToggleHidden(!e.target.checked)}
            className="rounded border-border"
          />
          <span className="text-sm text-muted-foreground whitespace-nowrap">Visible</span>
        </label>
      </div>

      {/* Hidden for Roles */}
      {!isHidden && (
        <div className="hidden sm:flex items-center gap-2">
          <span className="text-xs text-muted-foreground whitespace-nowrap">Hide for:</span>
          {roleOptions.map((role) => (
            <label key={role} className="flex items-center gap-1 cursor-pointer">
              <input
                type="checkbox"
                checked={hiddenForRoles.includes(role)}
                onChange={(e) => onToggleHiddenForRole(role, e.target.checked)}
                className="rounded border-border"
              />
              <span className="text-xs text-muted-foreground">
                {role === "active_member" ? "Member" : role === "admin" ? "Admin" : "Alumni"}
              </span>
            </label>
          ))}
        </div>
      )}

      {/* Lock Toggle */}
      <div className="flex items-center gap-2">
        <label className="flex items-center gap-2 cursor-pointer" title="Lock prevents sub-orgs from overriding this setting">
          <input
            type="checkbox"
            checked={isLocked}
            onChange={(e) => onToggleLocked(e.target.checked)}
            className="rounded border-border"
          />
          <LockIcon className={`h-4 w-4 ${isLocked ? "text-purple-600" : "text-muted-foreground"}`} />
        </label>
      </div>
    </div>
  );
}

function LockIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z"
      />
    </svg>
  );
}
