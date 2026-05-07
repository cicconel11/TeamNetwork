"use client";

import { useTranslations } from "next-intl";
import { Card, Badge, Button } from "@/components/ui";

interface PermissionRoleCardProps {
  title: string;
  description: string;
  featureVerb: string;
  roles: string[];
  onToggleRole: (role: string) => void;
  onSave: () => void;
  saving: boolean;
  error: string | null;
  success: string | null;
}

export function PermissionRoleCard({
  title,
  description,
  featureVerb,
  roles,
  onToggleRole,
  onSave,
  saving,
  error,
  success,
}: PermissionRoleCardProps) {
  const tCustom = useTranslations("customization");
  const tCommon = useTranslations("common");

  const ROLE_OPTIONS = [
    { value: "active_member", label: tCustom("permissions.roleLabels.activeMembers") },
    { value: "alumni", label: tCustom("permissions.roleLabels.alumni") },
    { value: "parent", label: tCustom("permissions.roleLabels.parents") },
  ];

  return (
    <Card className="org-settings-card p-5 space-y-4 opacity-0 translate-y-2">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-semibold text-foreground">{title}</p>
          <p className="text-sm text-muted-foreground">{description}</p>
        </div>
        <Badge variant="muted">{tCommon("admin")}</Badge>
      </div>

      <div className="space-y-3">
        <label className="flex items-center gap-3 cursor-not-allowed opacity-60">
          <input type="checkbox" className="h-4 w-4 rounded border-border" checked disabled />
          <div>
            <span className="font-medium text-sm text-foreground">{tCommon("admin")}</span>
            <p className="text-xs text-muted-foreground">{tCustom("permissions.adminAlways", { verb: featureVerb })}</p>
          </div>
        </label>
        {ROLE_OPTIONS.map((opt) => (
          <label key={opt.value} className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-border"
              checked={roles.includes(opt.value)}
              onChange={() => onToggleRole(opt.value)}
            />
            <div>
              <span className="font-medium text-sm text-foreground">{opt.label}</span>
              <p className="text-xs text-muted-foreground">
                {tCustom("permissions.allow", { role: opt.label.toLowerCase(), verb: featureVerb })}
              </p>
            </div>
          </label>
        ))}
      </div>

      {success && <div className="text-sm text-green-600 dark:text-green-400">{success}</div>}
      {error && <div className="text-sm text-red-600 dark:text-red-400">{error}</div>}

      <div className="flex justify-end pt-1">
        <Button onClick={onSave} isLoading={saving}>
          {tCustom("permissions.savePermissions")}
        </Button>
      </div>
    </Card>
  );
}
