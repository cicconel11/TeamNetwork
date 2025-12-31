"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { PageHeader } from "@/components/layout";
import { Button, Card, Input, Badge } from "@/components/ui";
import { AdminGuard } from "@/components/auth";
import { ORG_NAV_ITEMS, type NavConfig, type NavConfigEntry } from "@/lib/navigation/nav-items";
import type { OrgRole } from "@/lib/auth/role-utils";

const CONFIGURABLE_ITEMS = ORG_NAV_ITEMS.filter((item) => item.configurable !== false);
const ROLE_LABELS: Record<OrgRole, string> = {
  admin: "Admins",
  active_member: "Active members",
  alumni: "Alumni",
};
const ALLOWED_ROLES: OrgRole[] = ["admin", "active_member", "alumni"];

function NavigationSettingsContent() {
  const params = useParams();
  const orgSlug = params.orgSlug as string;
  const router = useRouter();

  const [orgId, setOrgId] = useState<string | null>(null);
  const [navConfig, setNavConfig] = useState<NavConfig>({});
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const loadConfig = async () => {
      setIsLoading(true);
      setError(null);
      setSaved(false);

      const supabase = createClient();
      const { data: org, error: orgError } = await supabase
        .from("organizations")
        .select("id, nav_config")
        .eq("slug", orgSlug)
        .maybeSingle();

      if (orgError || !org) {
        setError(orgError?.message || "Organization not found");
        setIsLoading(false);
        return;
      }

      setOrgId(org.id);
      const rawConfig = org.nav_config;
      if (rawConfig && typeof rawConfig === "object" && !Array.isArray(rawConfig)) {
        setNavConfig(rawConfig as NavConfig);
      } else {
        setNavConfig({});
      }

      setIsLoading(false);
    };

    loadConfig();
  }, [orgSlug]);

  const updateEntry = (href: string, updater: (entry?: NavConfigEntry) => NavConfigEntry | undefined) => {
    setNavConfig((prev) => {
      const updated = { ...prev };
      const nextValue = updater(prev[href]);
      if (nextValue && Object.keys(nextValue).length > 0) {
        updated[href] = nextValue;
      } else {
        delete updated[href];
      }
      return updated;
    });
    setSaved(false);
  };

  const handleLabelChange = (href: string, label: string) => {
    updateEntry(href, (current = {}) => {
      const trimmed = label.trim();
      const next: NavConfigEntry = { ...current };
      if (trimmed) {
        next.label = trimmed;
      } else {
        delete next.label;
      }
      if (!next.hidden && !next.hiddenForRoles?.length) {
        return Object.keys(next).length ? next : undefined;
      }
      return next;
    });
  };

  const toggleRoleHidden = (href: string, role: OrgRole) => {
    updateEntry(href, (current = {}) => {
      const roles = Array.isArray(current.hiddenForRoles) ? [...current.hiddenForRoles] : [];
      const exists = roles.includes(role);
      const nextRoles = exists ? roles.filter((r) => r !== role) : [...roles, role];
      const next: NavConfigEntry = { ...current };
      if (nextRoles.length) {
        next.hiddenForRoles = nextRoles;
      } else {
        delete next.hiddenForRoles;
      }
      if (!next.label && !next.hidden && !next.hiddenForRoles?.length) {
        return undefined;
      }
      return next;
    });
  };

  const toggleHiddenEverywhere = (href: string) => {
    updateEntry(href, (current = {}) => {
      const next: NavConfigEntry = { ...current };
      next.hidden = !current.hidden;
      if (!next.hidden) {
        delete next.hidden;
      }
      if (!next.label && !next.hiddenForRoles?.length && !next.hidden) {
        return undefined;
      }
      return next;
    });
  };

  const toggleEditRole = (href: string, role: OrgRole) => {
    updateEntry(href, (current = {}) => {
      const existing = Array.isArray(current.editRoles) ? [...current.editRoles] : [];
      const hasRole = existing.includes(role);
      const nextRoles = hasRole ? existing.filter((r) => r !== role) : [...existing, role];
      const next: NavConfigEntry = { ...current, editRoles: Array.from(new Set([...nextRoles, "admin"])) };
      if (next.editRoles.length === 0 || (next.editRoles.length === 1 && next.editRoles[0] === "admin")) {
        delete next.editRoles;
      }
      if (!next.label && !next.hidden && !next.hiddenForRoles?.length && !next.editRoles?.length) {
        return undefined;
      }
      return next;
    });
  };

  const resetTab = (href: string) => {
    setNavConfig((prev) => {
      const next = { ...prev };
      delete next[href];
      return next;
    });
    setSaved(false);
  };

  const preparePayload = (): NavConfig => {
    const payload: NavConfig = {};

    for (const item of ORG_NAV_ITEMS) {
      const entry = navConfig[item.href];
      if (!entry) continue;

      const clean: NavConfigEntry = {};

      if (typeof entry.label === "string" && entry.label.trim()) {
        clean.label = entry.label.trim();
      }
      if (entry.hidden) {
        clean.hidden = true;
      }
      if (Array.isArray(entry.hiddenForRoles) && entry.hiddenForRoles.length > 0) {
        const roles = entry.hiddenForRoles.filter((role): role is OrgRole => ALLOWED_ROLES.includes(role as OrgRole));
        if (roles.length) {
          clean.hiddenForRoles = Array.from(new Set(roles));
        }
      }
      if (Array.isArray(entry.editRoles) && entry.editRoles.length > 0) {
        const roles = entry.editRoles.filter((role): role is OrgRole => ALLOWED_ROLES.includes(role as OrgRole));
        if (roles.length) {
          clean.editRoles = Array.from(new Set([...roles, "admin"] as OrgRole[]));
        }
      }

      if (Object.keys(clean).length > 0) {
        payload[item.href] = clean;
      }
    }

    return payload;
  };

  const handleSave = async () => {
    if (!orgId) return;
    setIsSaving(true);
    setSaved(false);
    setError(null);

    const payload = preparePayload();

    try {
      const res = await fetch(`/api/organizations/${orgId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ navConfig: payload }),
      });

      const data = await res.json().catch(() => null);

      if (!res.ok) {
        throw new Error(data?.error || "Unable to save navigation");
      }

      setNavConfig((data?.navConfig as NavConfig) || payload);
      setSaved(true);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to save navigation");
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[240px]">
        <div className="animate-spin h-8 w-8 border-4 border-org-primary border-t-transparent rounded-full" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Navigation"
        description="Rename tabs or hide them from members and alumni. Admins keep access unless a tab is fully disabled."
        backHref={`/${orgSlug}`}
        actions={
          <Button onClick={handleSave} isLoading={isSaving} disabled={!orgId}>
            Save changes
          </Button>
        }
      />

      {error && (
        <div className="p-3 rounded-xl bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 text-sm">
          {error}
        </div>
      )}

      {saved && (
        <div className="p-3 rounded-xl bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-300 text-sm">
          Navigation updated. Refresh the sidebar to see your changes.
        </div>
      )}

      <div className="grid grid-cols-1 gap-4">
        {CONFIGURABLE_ITEMS.map((item) => {
          const entry = navConfig[item.href];
          const labelValue = typeof entry?.label === "string" ? entry.label : "";
          const hiddenForRoles = Array.isArray(entry?.hiddenForRoles) ? (entry.hiddenForRoles as OrgRole[]) : [];
          const isHiddenEverywhere = entry?.hidden === true;
          const hasChanges = Boolean(entry && Object.keys(entry).length);
          const editRoles = Array.isArray(entry?.editRoles) ? (entry.editRoles as OrgRole[]) : ["admin"];

          return (
            <Card key={item.href} className={isHiddenEverywhere ? "border-red-200 dark:border-red-900/40" : ""}>
              <div className="flex items-start justify-between gap-3">
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground">Path: {item.href || "/"}</p>
                  <h3 className="text-lg font-semibold text-foreground">{labelValue?.trim() || item.label}</h3>
                  <p className="text-sm text-muted-foreground">
                    Default roles: {item.roles.map((role) => ROLE_LABELS[role]).join(", ")}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {isHiddenEverywhere && <Badge variant="error">Disabled</Badge>}
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => resetTab(item.href)}
                    disabled={!hasChanges}
                  >
                    Reset
                  </Button>
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-2 mt-4">
                <Input
                  id={`${item.href || "root"}-label`}
                  label="Display name"
                  value={labelValue}
                  onChange={(e) => handleLabelChange(item.href, e.target.value)}
                  placeholder={item.label}
                />

                <div className="space-y-2">
                  <p className="text-sm font-medium text-foreground">Visibility</p>
                  <label className="flex items-center gap-3 text-sm text-foreground">
                    <input
                      type="checkbox"
                      className="h-4 w-4 rounded border-border"
                      checked={hiddenForRoles.includes("active_member")}
                      onChange={() => toggleRoleHidden(item.href, "active_member")}
                    />
                    Hide from active members
                  </label>
                  <label className="flex items-center gap-3 text-sm text-foreground">
                    <input
                      type="checkbox"
                      className="h-4 w-4 rounded border-border"
                      checked={hiddenForRoles.includes("alumni")}
                      onChange={() => toggleRoleHidden(item.href, "alumni")}
                    />
                    Hide from alumni
                  </label>
                  <label className="flex items-center gap-3 text-sm text-foreground">
                    <input
                      type="checkbox"
                      className="h-4 w-4 rounded border-border"
                      checked={isHiddenEverywhere}
                      onChange={() => toggleHiddenEverywhere(item.href)}
                    />
                    Disable tab for everyone (including admins)
                  </label>
                </div>

                <div className="space-y-2">
                  <p className="text-sm font-medium text-foreground">Who can edit this page?</p>
                  <p className="text-xs text-muted-foreground">Admins are always allowed.</p>
                  <label className="flex items-center gap-3 text-sm text-foreground">
                    <input type="checkbox" className="h-4 w-4 rounded border-border" checked disabled />
                    Admins (always on)
                  </label>
                  <label className="flex items-center gap-3 text-sm text-foreground">
                    <input
                      type="checkbox"
                      className="h-4 w-4 rounded border-border"
                      checked={editRoles.includes("active_member")}
                      onChange={() => toggleEditRole(item.href, "active_member")}
                    />
                    Active members
                  </label>
                  <label className="flex items-center gap-3 text-sm text-foreground">
                    <input
                      type="checkbox"
                      className="h-4 w-4 rounded border-border"
                      checked={editRoles.includes("alumni")}
                      onChange={() => toggleEditRole(item.href, "alumni")}
                    />
                    Alumni
                  </label>
                </div>
              </div>
            </Card>
          );
        })}
      </div>

      <div className="flex items-center justify-end gap-3">
        {saved && <p className="text-sm text-muted-foreground">Saved</p>}
        <Button onClick={handleSave} isLoading={isSaving} disabled={!orgId}>
          Save changes
        </Button>
      </div>
    </div>
  );
}

export default function NavigationSettingsPage() {
  return (
    <AdminGuard>
      <NavigationSettingsContent />
    </AdminGuard>
  );
}
