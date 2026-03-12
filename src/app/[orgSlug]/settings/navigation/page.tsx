"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { PageHeader } from "@/components/layout";
import { Button, Card, Input, Badge } from "@/components/ui";
import { AdminGuard } from "@/components/auth";
import { ORG_NAV_ITEMS, ORG_NAV_GROUPS, type NavConfig, type NavConfigEntry, type NavGroupId, getConfigKey } from "@/lib/navigation/nav-items";
import { bucketItemsByGroup, type VisibleNavItem } from "@/lib/navigation/sidebar-groups";
import { getSettingsGroupKey, reorderItemWithinGroup } from "@/lib/navigation/navigation-settings-order";
import type { OrgRole } from "@/lib/auth/role-utils";
import {
  getAgeBracketFromUserMetadata,
  normalizeOrgType,
  resolveTrackingLevel,
  type AgeBracket,
} from "@/lib/analytics/policy";
import { setAnalyticsPolicy, type ConsentState } from "@/lib/analytics/events";

const CONFIGURABLE_ITEMS = ORG_NAV_ITEMS.filter((item) => item.configurable !== false);
const ALLOWED_ROLES: OrgRole[] = ["admin", "active_member", "alumni", "parent"];
const GROUP_ORDER: (NavGroupId | "standalone" | "dashboard")[] = [
  "dashboard",
  ...ORG_NAV_GROUPS.filter(g => g.id !== "admin").map(g => g.id),
  "standalone",
  "admin",
];

function NavigationSettingsContent() {
  const params = useParams();
  const orgSlug = params.orgSlug as string;
  const router = useRouter();

  const [orgId, setOrgId] = useState<string | null>(null);
  const [orgType, setOrgType] = useState<string>("general");
  const [navConfig, setNavConfig] = useState<NavConfig>({});
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [orderedItems, setOrderedItems] = useState<typeof CONFIGURABLE_ITEMS>([]);
  const [expandedItem, setExpandedItem] = useState<string | null>(null);
  const [consentState, setConsentState] = useState<ConsentState>("unknown");
  const [ageBracket, setAgeBracket] = useState<AgeBracket | null>(null);
  const [consentLoading, setConsentLoading] = useState(true);
  const [consentSaving, setConsentSaving] = useState(false);
  const [consentMessage, setConsentMessage] = useState<string | null>(null);

  const sortItemsByOrder = useCallback((items: typeof CONFIGURABLE_ITEMS, config: NavConfig) => {
    return [...items].sort((a, b) => {
      const keyA = a.href === "" ? "dashboard" : a.href;
      const keyB = b.href === "" ? "dashboard" : b.href;
      const orderA = config[keyA]?.order;
      const orderB = config[keyB]?.order;
      if (orderA !== undefined && orderB !== undefined) return orderA - orderB;
      if (orderA !== undefined) return -1;
      if (orderB !== undefined) return 1;
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
        .select("id, nav_config, org_type")
        .eq("slug", orgSlug)
        .maybeSingle();
      if (orgError || !org) {
        setError(orgError?.message || "Organization not found");
        setIsLoading(false);
        return;
      }
      setOrgId(org.id);
      setOrgType((org as Record<string, unknown>).org_type as string || "general");
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

  useEffect(() => {
    const loadConsent = async () => {
      if (!orgId) {
        setConsentLoading(false);
        return;
      }
      setConsentLoading(true);
      setConsentMessage(null);
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      const nextAgeBracket = getAgeBracketFromUserMetadata(user?.user_metadata);
      setAgeBracket(nextAgeBracket);
      if (!user) {
        setConsentState("unknown");
        setAnalyticsPolicy(orgId, "unknown", "none");
        setConsentLoading(false);
        return;
      }
      const { data } = await supabase
        .from("analytics_consent")
        .select("consent_state")
        .eq("org_id", orgId)
        .maybeSingle();
      const nextState = (data?.consent_state as ConsentState) ?? "unknown";
      setConsentState(nextState);
      setAnalyticsPolicy(
        orgId,
        nextState,
        resolveTrackingLevel(
          nextState === "opted_in",
          nextAgeBracket,
          normalizeOrgType(orgType),
        ),
      );
      setConsentLoading(false);
    };
    loadConsent();
  }, [orgId, orgType]);

  const handleConsentToggle = async (nextConsented: boolean) => {
    if (!orgId || consentSaving) return;
    setConsentSaving(true);
    setConsentMessage(null);
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      setConsentSaving(false);
      setConsentMessage("You must be signed in.");
      return;
    }
    const nextAgeBracket = getAgeBracketFromUserMetadata(user.user_metadata);
    setAgeBracket(nextAgeBracket);
    const nextState = nextConsented ? "opted_in" : "opted_out";
    const { error: updateError } = await supabase
      .from("analytics_consent")
      .upsert(
        { org_id: orgId, user_id: user.id, consent_state: nextState },
        { onConflict: "org_id,user_id" },
      );
    if (updateError) {
      setConsentMessage(updateError.message || "Failed to update preference");
      setConsentSaving(false);
      return;
    }
    setConsentState(nextState);
    setAnalyticsPolicy(
      orgId,
      nextState,
      resolveTrackingLevel(
        nextState === "opted_in",
        nextAgeBracket,
        normalizeOrgType(orgType),
      ),
    );
    setConsentSaving(false);
  };

  const maxTrackingLevel = resolveTrackingLevel(
    true,
    ageBracket,
    normalizeOrgType(orgType),
  );

  const groupedItems = useMemo(
    () => bucketItemsByGroup(orderedItems as VisibleNavItem[]),
    [orderedItems],
  );

  const updateEntry = (href: string, updater: (entry?: NavConfigEntry) => NavConfigEntry | undefined) => {
    const key = getConfigKey(href);
    setNavConfig((prev) => {
      const updated = { ...prev };
      const nextValue = updater(prev[key]);
      if (nextValue && Object.keys(nextValue).length > 0) {
        updated[key] = nextValue;
      } else {
        delete updated[key];
      }
      return updated;
    });
    setSaved(false);
  };

  const handleLabelChange = (href: string, label: string) => {
    updateEntry(href, (current = {}) => {
      const trimmed = label.trim();
      const next: NavConfigEntry = { ...current };
      if (trimmed) next.label = trimmed;
      else delete next.label;
      if (!next.hidden && !next.hiddenForRoles?.length && next.order === undefined) {
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
      if (nextRoles.length) next.hiddenForRoles = nextRoles;
      else delete next.hiddenForRoles;
      if (!next.label && !next.hidden && !next.hiddenForRoles?.length && next.order === undefined) return undefined;
      return next;
    });
  };

  const toggleHiddenEverywhere = (href: string) => {
    updateEntry(href, (current = {}) => {
      const next: NavConfigEntry = { ...current };
      next.hidden = !current.hidden;
      if (!next.hidden) delete next.hidden;
      if (!next.label && !next.hiddenForRoles?.length && !next.hidden && next.order === undefined) return undefined;
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
      if (editCount === 0 || (editCount === 1 && next.editRoles?.[0] === "admin")) delete next.editRoles;
      const hasHiddenRoles = !!next.hiddenForRoles?.length;
      const hasEditRoles = !!next.editRoles?.length;
      if (!next.label && !next.hidden && !hasHiddenRoles && !hasEditRoles && next.order === undefined) return undefined;
      return next;
    });
  };

  const moveItem = (href: string, direction: "up" | "down") => {
    const item = orderedItems.find(i => i.href === href);
    if (!item) return;
    const itemGroup = getSettingsGroupKey(item);
    const newItems = reorderItemWithinGroup(orderedItems, href, direction);
    if (newItems === orderedItems) return;

    setOrderedItems(newItems);
    setNavConfig(prev => {
      const updated = { ...prev };
      // Re-index only items in the affected group
      const updatedGroupItems = newItems.filter((candidate) => getSettingsGroupKey(candidate) === itemGroup);
      updatedGroupItems.forEach((gi, index) => {
        const key = getConfigKey(gi.href);
        if (!updated[key]) updated[key] = {};
        updated[key] = { ...updated[key], order: index };
      });
      return updated;
    });
    setSaved(false);
  };

  const preparePayload = (): NavConfig => {
    const payload: NavConfig = {};
    for (const item of ORG_NAV_ITEMS) {
      const key = getConfigKey(item.href);
      const entry = navConfig[key];
      if (!entry) continue;
      const clean: NavConfigEntry = {};
      if (typeof entry.label === "string" && entry.label.trim()) clean.label = entry.label.trim();
      if (entry.hidden) clean.hidden = true;
      if (Array.isArray(entry.hiddenForRoles) && entry.hiddenForRoles.length > 0) {
        const roles = entry.hiddenForRoles.filter((role): role is OrgRole => ALLOWED_ROLES.includes(role as OrgRole));
        if (roles.length) clean.hiddenForRoles = Array.from(new Set(roles));
      }
      if (Array.isArray(entry.editRoles) && entry.editRoles.length > 0) {
        const roles = entry.editRoles.filter((role): role is OrgRole => ALLOWED_ROLES.includes(role as OrgRole));
        if (roles.length) clean.editRoles = Array.from(new Set([...roles, "admin"] as OrgRole[]));
      }
      if (typeof entry.order === "number") clean.order = entry.order;
      if (Object.keys(clean).length > 0) payload[key] = clean;
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
      if (!res.ok) throw new Error(data?.error || "Unable to save navigation");
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
        description="Items are organized in sidebar sections. Rename items, adjust visibility, or reorder within each section."
        backHref={`/${orgSlug}`}
        actions={
          <Button onClick={handleSave} isLoading={isSaving} disabled={!orgId}>
            Save changes
          </Button>
        }
      />
      <Card className="p-6">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h3 className="font-semibold text-foreground">Usage Analytics (Admin)</h3>
            <p className="text-sm text-muted-foreground">
              {maxTrackingLevel === "page_view_only"
                ? "Control your personal analytics consent for this organization. Your account or organization is limited to page-level analytics even when you opt in."
                : maxTrackingLevel === "none"
                  ? "Usage analytics are unavailable for this account under the current compliance rules."
                  : "Control your personal analytics consent for this organization. Behavioral analytics are disabled by default until you opt in."}
            </p>
          </div>
          <Badge variant="muted" className="uppercase tracking-wide">
            {maxTrackingLevel === "page_view_only"
              ? "Page Views Only"
              : consentState === "opted_in"
                ? "Opted In"
                : consentState === "opted_out"
                  ? "Opted Out"
                  : "Not Set"}
          </Badge>
        </div>
        <div className="mt-4 flex items-center gap-3">
          <label htmlFor="analytics-consent-toggle" className="flex items-center gap-3 cursor-pointer">
            <input
              id="analytics-consent-toggle"
              type="checkbox"
              className="h-4 w-4 rounded border-border"
              checked={consentState === "opted_in"}
              disabled={consentLoading || consentSaving || maxTrackingLevel === "none"}
              onChange={(e) => handleConsentToggle(e.target.checked)}
            />
            <span className="text-sm text-foreground">
              {maxTrackingLevel === "page_view_only"
                ? "Enable limited opt-in usage analytics"
                : "Enable opt-in usage analytics"}
            </span>
          </label>
          {consentLoading && <span className="text-xs text-muted-foreground">Loading...</span>}
          {consentSaving && <span className="text-xs text-muted-foreground">Saving...</span>}
        </div>
        {consentMessage && (
          <div className="mt-3 text-sm text-red-600 dark:text-red-400">
            {consentMessage}
          </div>
        )}
      </Card>
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
        {(() => {
          return GROUP_ORDER.map((groupKey) => {
            const items = groupedItems.get(groupKey);
            if (!items || items.length === 0) return null;
            const groupLabel =
              groupKey === "dashboard" ? "Dashboard" :
              groupKey === "standalone" ? "Other" :
              ORG_NAV_GROUPS.find(g => g.id === groupKey)?.label ?? groupKey;
            return (
              <div key={groupKey}>
                <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider px-1 pt-4 pb-2">
                  {groupLabel}
                </h3>
                {items.map((item) => {
                  const configKey = getConfigKey(item.href);
                  const entry = navConfig[configKey];
                  const labelValue = typeof entry?.label === "string" ? entry.label : "";
                  const hiddenForRoles = Array.isArray(entry?.hiddenForRoles) ? (entry.hiddenForRoles as OrgRole[]) : [];
                  const isHiddenEverywhere = entry?.hidden === true;
                  const editRoles = Array.isArray(entry?.editRoles) ? (entry.editRoles as OrgRole[]) : ["admin"];
                  const isExpanded = expandedItem === item.href;
                  // Within-group boundary checks (uses memoized groupedItems map)
                  const itemGroup = item.href === "" ? "dashboard" : (item.group ?? "standalone");
                  const siblings = groupedItems.get(itemGroup as NavGroupId | "standalone" | "dashboard") ?? [];
                  const groupIndex = siblings.findIndex(i => i.href === item.href);
                  const isFirst = groupIndex === 0;
                  const isLast = groupIndex === siblings.length - 1;

                  return (
                    <Card key={configKey} className={`p-3 transition-all duration-200 ${isHiddenEverywhere ? "border-red-200 dark:border-red-900/40 opacity-60" : ""}`}>
                      <div className="flex items-center gap-3">
                        <div className="flex flex-col gap-0.5">
                          <button
                            onClick={() => moveItem(item.href, "up")}
                            disabled={isFirst}
                            className={`p-1 rounded transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 ${isFirst ? "text-muted-foreground/30 cursor-not-allowed" : "text-muted-foreground hover:text-foreground hover:bg-muted"}`}
                            title="Move up"
                            aria-label="Move item up"
                          >
                            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 15.75l7.5-7.5 7.5 7.5" />
                            </svg>
                          </button>
                          <button
                            onClick={() => moveItem(item.href, "down")}
                            disabled={isLast}
                            className={`p-1 rounded transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 ${isLast ? "text-muted-foreground/30 cursor-not-allowed" : "text-muted-foreground hover:text-foreground hover:bg-muted"}`}
                            title="Move down"
                            aria-label="Move item down"
                          >
                            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
                            </svg>
                          </button>
                        </div>
                        <item.icon className="h-5 w-5 text-muted-foreground flex-shrink-0" />
                        <div className="flex-1 min-w-0">
                          <span className="font-medium text-foreground">{labelValue?.trim() || item.label}</span>
                          {labelValue && labelValue !== item.label && <span className="text-xs text-muted-foreground ml-2">({item.label})</span>}
                        </div>
                        <div className="flex items-center gap-2">
                          {isHiddenEverywhere && <Badge variant="error">Disabled</Badge>}
                          {hiddenForRoles.length > 0 && !isHiddenEverywhere && <Badge variant="warning">Partial</Badge>}
                        </div>
                        <button onClick={() => setExpandedItem(isExpanded ? null : item.href)} className="p-1 hover:bg-muted rounded transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1" aria-label={isExpanded ? "Collapse settings" : "Expand settings"}>
                          <svg className={`h-5 w-5 text-muted-foreground transition-transform ${isExpanded ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
                          </svg>
                        </button>
                      </div>
                      {isExpanded && (
                        <div className="mt-4 pt-4 border-t border-border space-y-4 animate-in slide-in-from-top-2 duration-200">
                          <div className="grid gap-4 md:grid-cols-2">
                            <Input id={`${item.href || "root"}-label`} label="Display name" value={labelValue} onChange={(e) => handleLabelChange(item.href, e.target.value)} placeholder={item.label} />
                            <div className="space-y-2">
                              <p className="text-sm font-medium text-foreground">Visibility</p>
                              <label className="flex items-center gap-2 text-sm text-foreground">
                                <input type="checkbox" className="h-4 w-4 rounded border-border" checked={hiddenForRoles.includes("active_member")} onChange={() => toggleRoleHidden(item.href, "active_member")} />
                                Hide from members
                              </label>
                              <label className="flex items-center gap-2 text-sm text-foreground">
                                <input type="checkbox" className="h-4 w-4 rounded border-border" checked={hiddenForRoles.includes("alumni")} onChange={() => toggleRoleHidden(item.href, "alumni")} />
                                Hide from alumni
                              </label>
                              <label className="flex items-center gap-2 text-sm text-foreground">
                                <input type="checkbox" className="h-4 w-4 rounded border-border" checked={hiddenForRoles.includes("parent")} onChange={() => toggleRoleHidden(item.href, "parent")} />
                                Hide from parents
                              </label>
                              <label className="flex items-center gap-2 text-sm text-foreground">
                                <input type="checkbox" className="h-4 w-4 rounded border-border" checked={isHiddenEverywhere} onChange={() => toggleHiddenEverywhere(item.href)} />
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
                                <input type="checkbox" className="h-4 w-4 rounded border-border" checked={editRoles.includes("active_member")} onChange={() => toggleEditRole(item.href, "active_member")} />
                                Members
                              </label>
                              <label className="flex items-center gap-2 text-sm text-foreground">
                                <input type="checkbox" className="h-4 w-4 rounded border-border" checked={editRoles.includes("alumni")} onChange={() => toggleEditRole(item.href, "alumni")} />
                                Alumni
                              </label>
                              <label className="flex items-center gap-2 text-sm text-foreground">
                                <input type="checkbox" className="h-4 w-4 rounded border-border" checked={editRoles.includes("parent")} onChange={() => toggleEditRole(item.href, "parent")} />
                                Parents
                              </label>
                            </div>
                          </div>
                        </div>
                      )}
                    </Card>
                  );
                })}
              </div>
            );
          });
        })()}
      </div>
      <div className="flex items-center justify-end gap-3 pt-4">
        {saved && <p className="text-sm text-muted-foreground">Saved</p>}
        <Button onClick={handleSave} isLoading={isSaving} disabled={!orgId}>Save changes</Button>
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
