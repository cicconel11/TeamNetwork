"use client";

import { useEffect, useState, useCallback } from "react";
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
  const [draggedItem, setDraggedItem] = useState<string | null>(null);
  const [orderedItems, setOrderedItems] = useState<typeof CONFIGURABLE_ITEMS>([]);

  // Sort items by their order in navConfig
  const sortItemsByOrder = useCallback((items: typeof CONFIGURABLE_ITEMS, config: NavConfig) => {
    return [...items].sort((a, b) => {
      const orderA = config[a.href]?.order ?? 999;
      const orderB = config[b.href]?.order ?? 999;
      if (orderA !== orderB) return orderA - orderB;
      // Fall back to default order
      return items.indexOf(a) - items.indexOf(b);
    });
  }, []);

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
      let config: NavConfig = {};
      if (rawConfig && typeof rawConfig === "object" && !Array.isArray(rawConfig)) {
        config = rawConfig as NavConfig;
      }
      setNavConfig(config);
      setOrderedItems(sortItemsByOrder(CONFIGURABLE_ITEMS, config));
      setIsLoading(false);
    };

    loadConfig();
  }, [orgSlug, sortItemsByOrder]);

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
      if (!next.hidden && !next.hiddenForRoles?.length && !next.order) {
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
      if (!next.label && !next.hidden && !next.hiddenForRoles?.length && !next.order) {
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
      if (!next.label && !next.hiddenForRoles?.length && !next.hidden && !next.order) {
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
      const editCount = next.editRoles?.length ?? 0;
      if (editCount === 0 || (editCount === 1 && next.editRoles?.[0] === "admin")) {
        delete next.editRoles;
      }
      const hasHiddenRoles = !!next.hiddenForRoles?.length;
      const hasEditRoles = !!next.editRoles?.length;
      if (!next.label && !next.hidden && !hasHiddenRoles && !hasEditRoles && !next.order) {
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
    setOrderedItems(sortItemsByOrder(CONFIGURABLE_ITEMS, {}));
    setSaved(false);
  };

  // Drag and drop handlers
  const handleDragStart = (e: React.DragEvent, href: string) => {
    setDraggedItem(href);
    e.dataTransfer.effectAllowed = "move";
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  };

  const handleDrop = (e: React.DragEvent, targetHref: string) => {
    e.preventDefault();
    if (!draggedItem || draggedItem === targetHref) {
      setDraggedItem(null);
      return;
    }

    const draggedIndex = orderedItems.findIndex(item => item.href === draggedItem);
    const targetIndex = orderedItems.findIndex(item => item.href === targetHref);

    if (draggedIndex === -1 || targetIndex === -1) {
      setDraggedItem(null);
      return;
    }

    // Reorder the items
    const newItems = [...orderedItems];
    const [removed] = newItems.splice(draggedIndex, 1);
    newItems.splice(targetIndex, 0, removed);
    setOrderedItems(newItems);

    // Update navConfig with new order
    setNavConfig(prev => {
      const updated = { ...prev };
      newItems.forEach((item, index) => {
        if (!updated[item.href]) {
          updated[item.href] = {};
        }
        updated[item.href] = { ...updated[item.href], order: index };
      });
      return updated;
    });

    setSaved(false);
    setDraggedItem(null);
  };

  const handleDragEnd = () => {
    setDraggedItem(null);
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
      if (typeof entry.order === "number") {
        clean.order = entry.order;
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
        description="Drag tabs to reorder, rename them, or hide them from members and alumni."
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

      <div className="p-3 rounded-xl bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300 text-sm flex items-center gap-2">
        <svg className="h-5 w-5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" />
        </svg>
        <span>Drag the handle on the left of each tab to reorder them in the sidebar.</span>
      </div>

      <div className="grid grid-cols-1 gap-4">
        {orderedItems.map((item) => {
          const entry = navConfig[item.href];
          const labelValue = typeof entry?.label === "string" ? entry.label : "";
          const hiddenForRoles = Array.isArray(entry?.hiddenForRoles) ? (entry.hiddenForRoles as OrgRole[]) : [];
          const isHiddenEverywhere = entry?.hidden === true;
          const hasChanges = Boolean(entry && Object.keys(entry).length);
          const editRoles = Array.isArray(entry?.editRoles) ? (entry.editRoles as OrgRole[]) : ["admin"];
          const isDragging = draggedItem === item.href;

          return (
            <Card 
              key={item.href} 
              className={`${isHiddenEverywhere ? "border-red-200 dark:border-red-900/40" : ""} ${isDragging ? "opacity-50 border-dashed" : ""}`}
              draggable
              onDragStart={(e) => handleDragStart(e, item.href)}
              onDragOver={handleDragOver}
              onDrop={(e) => handleDrop(e, item.href)}
              onDragEnd={handleDragEnd}
            >
              <div className="flex items-start gap-3">
                {/* Drag handle */}
                <div className="flex-shrink-0 cursor-grab active:cursor-grabbing p-2 -ml-2 text-muted-foreground hover:text-foreground">
                  <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
                  </svg>
                </div>

                <div className="flex-1">
                  <div className="flex items-start justify-between gap-3">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <item.icon className="h-5 w-5 text-muted-foreground" />
                        <h3 className="text-lg font-semibold text-foreground">{labelValue?.trim() || item.label}</h3>
                      </div>
                      <p className="text-xs text-muted-foreground">Path: {item.href || "/"}</p>
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
