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
  const [dragOverItem, setDragOverItem] = useState<string | null>(null);
  const [orderedItems, setOrderedItems] = useState<typeof CONFIGURABLE_ITEMS>([]);
  const [expandedItem, setExpandedItem] = useState<string | null>(null);

  // Sort items by their order in navConfig
  // Use the same logic as OrgSidebar: items with explicit order come first, then default order
  const sortItemsByOrder = useCallback((items: typeof CONFIGURABLE_ITEMS, config: NavConfig) => {
    return [...items].sort((a, b) => {
      const orderA = config[a.href]?.order;
      const orderB = config[b.href]?.order;
      
      // If both have explicit orders, compare them
      if (orderA !== undefined && orderB !== undefined) {
        return orderA - orderB;
      }
      // If only one has an explicit order, it comes first
      if (orderA !== undefined) return -1;
      if (orderB !== undefined) return 1;
      // If neither has an order, use default position from ORG_NAV_ITEMS
      return ORG_NAV_ITEMS.findIndex(i => i.href === a.href) - ORG_NAV_ITEMS.findIndex(i => i.href === b.href);
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

  // Drag and drop handlers
  const handleDragStart = (e: React.DragEvent, href: string) => {
    setDraggedItem(href);
    e.dataTransfer.effectAllowed = "move";
    // Add a slight delay to show the dragging state
    setTimeout(() => {
      const element = e.target as HTMLElement;
      element.style.opacity = "0.5";
    }, 0);
  };

  const handleDragOver = (e: React.DragEvent, href: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (draggedItem && href !== draggedItem) {
      setDragOverItem(href);
    }
  };

  const handleDragLeave = () => {
    setDragOverItem(null);
  };

  const handleDrop = (e: React.DragEvent, targetHref: string) => {
    e.preventDefault();
    if (!draggedItem || draggedItem === targetHref) {
      setDraggedItem(null);
      setDragOverItem(null);
      return;
    }

    const draggedIndex = orderedItems.findIndex(item => item.href === draggedItem);
    const targetIndex = orderedItems.findIndex(item => item.href === targetHref);

    if (draggedIndex === -1 || targetIndex === -1) {
      setDraggedItem(null);
      setDragOverItem(null);
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
    setDragOverItem(null);
  };

  const handleDragEnd = (e: React.DragEvent) => {
    const element = e.target as HTMLElement;
    element.style.opacity = "1";
    setDraggedItem(null);
    setDragOverItem(null);
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

      <div className="space-y-2">
        {orderedItems.map((item) => {
          const entry = navConfig[item.href];
          const labelValue = typeof entry?.label === "string" ? entry.label : "";
          const hiddenForRoles = Array.isArray(entry?.hiddenForRoles) ? (entry.hiddenForRoles as OrgRole[]) : [];
          const isHiddenEverywhere = entry?.hidden === true;
          const editRoles = Array.isArray(entry?.editRoles) ? (entry.editRoles as OrgRole[]) : ["admin"];
          const isDragging = draggedItem === item.href;
          const isDragOver = dragOverItem === item.href;
          const isExpanded = expandedItem === item.href;

          return (
            <div
              key={item.href}
              draggable
              onDragStart={(e) => handleDragStart(e, item.href)}
              onDragOver={(e) => handleDragOver(e, item.href)}
              onDragLeave={handleDragLeave}
              onDrop={(e) => handleDrop(e, item.href)}
              onDragEnd={handleDragEnd}
              className={`
                transition-all duration-200 ease-in-out
                ${isDragging ? "opacity-50 scale-[0.98]" : ""}
                ${isDragOver ? "transform translate-y-2" : ""}
              `}
            >
              {/* Drop indicator */}
              {isDragOver && (
                <div className="h-1 bg-[var(--color-org-secondary)] rounded-full mb-2 animate-pulse" />
              )}
              
              <Card 
                className={`
                  p-3 cursor-grab active:cursor-grabbing
                  ${isHiddenEverywhere ? "border-red-200 dark:border-red-900/40 opacity-60" : ""}
                  ${isDragOver ? "border-[var(--color-org-secondary)] border-2" : ""}
                  hover:shadow-md transition-shadow
                `}
              >
                <div className="flex items-center gap-3">
                  {/* Drag handle */}
                  <div className="flex-shrink-0 text-muted-foreground hover:text-foreground">
                    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
                    </svg>
                  </div>

                  {/* Icon */}
                  <item.icon className="h-5 w-5 text-muted-foreground flex-shrink-0" />

                  {/* Name */}
                  <div className="flex-1 min-w-0">
                    <span className="font-medium text-foreground">
                      {labelValue?.trim() || item.label}
                    </span>
                    {labelValue && labelValue !== item.label && (
                      <span className="text-xs text-muted-foreground ml-2">({item.label})</span>
                    )}
                  </div>

                  {/* Badges */}
                  <div className="flex items-center gap-2">
                    {isHiddenEverywhere && <Badge variant="error">Disabled</Badge>}
                    {hiddenForRoles.length > 0 && !isHiddenEverywhere && (
                      <Badge variant="warning">Partial</Badge>
                    )}
                  </div>

                  {/* Expand button */}
                  <button
                    onClick={() => setExpandedItem(isExpanded ? null : item.href)}
                    className="p-1 hover:bg-muted rounded transition-colors"
                  >
                    <svg 
                      className={`h-5 w-5 text-muted-foreground transition-transform ${isExpanded ? "rotate-180" : ""}`} 
                      fill="none" 
                      viewBox="0 0 24 24" 
                      stroke="currentColor" 
                      strokeWidth={2}
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
                    </svg>
                  </button>
                </div>

                {/* Expanded settings */}
                {isExpanded && (
                  <div className="mt-4 pt-4 border-t border-border space-y-4 animate-in slide-in-from-top-2 duration-200">
                    <div className="grid gap-4 md:grid-cols-2">
                      <Input
                        id={`${item.href || "root"}-label`}
                        label="Display name"
                        value={labelValue}
                        onChange={(e) => handleLabelChange(item.href, e.target.value)}
                        placeholder={item.label}
                      />

                      <div className="space-y-2">
                        <p className="text-sm font-medium text-foreground">Visibility</p>
                        <label className="flex items-center gap-2 text-sm text-foreground">
                          <input
                            type="checkbox"
                            className="h-4 w-4 rounded border-border"
                            checked={hiddenForRoles.includes("active_member")}
                            onChange={() => toggleRoleHidden(item.href, "active_member")}
                          />
                          Hide from members
                        </label>
                        <label className="flex items-center gap-2 text-sm text-foreground">
                          <input
                            type="checkbox"
                            className="h-4 w-4 rounded border-border"
                            checked={hiddenForRoles.includes("alumni")}
                            onChange={() => toggleRoleHidden(item.href, "alumni")}
                          />
                          Hide from alumni
                        </label>
                        <label className="flex items-center gap-2 text-sm text-foreground">
                          <input
                            type="checkbox"
                            className="h-4 w-4 rounded border-border"
                            checked={isHiddenEverywhere}
                            onChange={() => toggleHiddenEverywhere(item.href)}
                          />
                          Disable for everyone
                        </label>
                      </div>
                    </div>

                    <div className="space-y-2">
                      <p className="text-sm font-medium text-foreground">Who can edit?</p>
                      <div className="flex flex-wrap gap-4">
                        <label className="flex items-center gap-2 text-sm text-foreground">
                          <input type="checkbox" className="h-4 w-4 rounded border-border" checked disabled />
                          Admins
                        </label>
                        <label className="flex items-center gap-2 text-sm text-foreground">
                          <input
                            type="checkbox"
                            className="h-4 w-4 rounded border-border"
                            checked={editRoles.includes("active_member")}
                            onChange={() => toggleEditRole(item.href, "active_member")}
                          />
                          Members
                        </label>
                        <label className="flex items-center gap-2 text-sm text-foreground">
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
                )}
              </Card>
            </div>
          );
        })}
      </div>

      <div className="flex items-center justify-end gap-3 pt-4">
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
