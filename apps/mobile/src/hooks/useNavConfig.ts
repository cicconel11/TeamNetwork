import { useEffect, useState, useRef, useCallback } from "react";
import { supabase, createPostgresChangesChannel} from "@/lib/supabase";
import { normalizeRole, roleFlags, type OrgRole } from "@teammeet/core";
import type { Json } from "@teammeet/types";
import * as sentry from "@/lib/analytics/sentry";

export interface NavConfigEntry {
  label?: string;
  hidden?: boolean;
  hiddenForRoles?: OrgRole[];
  editRoles?: OrgRole[];
  order?: number;
}

export type NavConfig = Record<string, NavConfigEntry>;

const ALLOWED_ROLES: OrgRole[] = ["admin", "active_member", "alumni", "parent"];
const ALLOWED_NAV_KEYS = new Set([
  "dashboard",
  "/members",
  "/connections",
  "/parents",
  "/chat",
  "/alumni",
  "/mentorship",
  "/workouts",
  "/competition",
  "/events",
  "/announcements",
  "/philanthropy",
  "/donations",
  "/expenses",
  "/records",
  "/schedules",
  "/forms",
  "/settings",
]);

function sanitizeNavConfig(config: NavConfig): NavConfig {
  const sanitized: NavConfig = {};

  for (const [href, entry] of Object.entries(config)) {
    if (!ALLOWED_NAV_KEYS.has(href) || !entry || typeof entry !== "object") continue;

    const clean: NavConfigEntry = {};
    if (typeof entry.label === "string" && entry.label.trim()) {
      clean.label = entry.label.trim().slice(0, 80);
    }
    if (entry.hidden === true) {
      clean.hidden = true;
    }
    if (Array.isArray(entry.hiddenForRoles)) {
      const roles = entry.hiddenForRoles.filter((role): role is OrgRole =>
        ALLOWED_ROLES.includes(role)
      );
      if (roles.length) {
        clean.hiddenForRoles = Array.from(new Set(roles));
      }
    }
    if (Array.isArray(entry.editRoles)) {
      const roles = entry.editRoles.filter((role): role is OrgRole =>
        ALLOWED_ROLES.includes(role)
      );
      if (roles.length) {
        clean.editRoles = Array.from(new Set([...roles, "admin"] as OrgRole[]));
      }
    }
    if (typeof entry.order === "number" && Number.isInteger(entry.order) && entry.order >= 0) {
      clean.order = Math.min(entry.order, 100);
    }

    if (Object.keys(clean).length > 0) {
      sanitized[href] = clean;
    }
  }

  return sanitized;
}

interface UseNavConfigReturn {
  navConfig: NavConfig;
  orgId: string | null;
  loading: boolean;
  saving: boolean;
  error: string | null;
  saveNavConfig: (config: NavConfig) => Promise<{ success: boolean; error?: string }>;
  refetch: () => void;
}

export function useNavConfig(orgId: string | null): UseNavConfigReturn {
  const isMountedRef = useRef(true);
  const [navConfig, setNavConfig] = useState<NavConfig>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchNavConfig = useCallback(async () => {
    if (!orgId) {
      setNavConfig({});
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);

      const { data, error: fetchError } = await supabase
        .from("organizations")
        .select("nav_config")
        .eq("id", orgId)
        .single();

      if (fetchError) throw fetchError;

      if (isMountedRef.current) {
        // Parse nav_config - it could be null or an object
        const rawConfig = data.nav_config;
        let config: NavConfig = {};
        if (rawConfig && typeof rawConfig === "object" && !Array.isArray(rawConfig)) {
          config = rawConfig as NavConfig;
        }
        setNavConfig(config);
        setError(null);
      }
    } catch (e) {
      sentry.captureException(e as Error, { context: "useNavConfig.fetchNavConfig" });
      if (isMountedRef.current) {
        setError((e as Error).message);
        setNavConfig({});
      }
    } finally {
      if (isMountedRef.current) {
        setLoading(false);
      }
    }
  }, [orgId]);

  // Initial fetch
  useEffect(() => {
    isMountedRef.current = true;
    fetchNavConfig();

    return () => {
      isMountedRef.current = false;
    };
  }, [fetchNavConfig]);

  // Real-time subscription for nav_config changes
  useEffect(() => {
    if (!orgId) return;

    const channel = createPostgresChangesChannel(`nav-config:${orgId}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "organizations",
          filter: `id=eq.${orgId}`,
        },
        () => {
          // Refetch when organization is updated (could be nav_config change from web)
          fetchNavConfig();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [orgId, fetchNavConfig]);

  const saveNavConfig = useCallback(
    async (config: NavConfig): Promise<{ success: boolean; error?: string }> => {
      if (!orgId) {
        return { success: false, error: "Organization not loaded" };
      }

      try {
        setSaving(true);

        const { data: userData, error: userError } = await supabase.auth.getUser();
        if (userError || !userData.user) {
          throw new Error("Not authenticated");
        }

        const { data: roleData, error: roleError } = await supabase
          .from("user_organization_roles")
          .select("role")
          .eq("user_id", userData.user.id)
          .eq("organization_id", orgId)
          .eq("status", "active")
          .single();
        if (roleError || !roleFlags(normalizeRole(roleData?.role)).isAdmin) {
          throw new Error("Only admins can update navigation settings");
        }

        const sanitizedConfig = sanitizeNavConfig(config);
        const { error: updateError } = await supabase
          .from("organizations")
          .update({ nav_config: sanitizedConfig as Json })
          .eq("id", orgId);
        if (updateError) {
          throw updateError;
        }

        if (isMountedRef.current) {
          setNavConfig(sanitizedConfig);
        }

        return { success: true };
      } catch (e) {
        sentry.captureException(e as Error, { context: "useNavConfig.saveNavConfig" });
        return { success: false, error: (e as Error).message };
      } finally {
        if (isMountedRef.current) {
          setSaving(false);
        }
      }
    },
    [orgId]
  );

  return {
    navConfig,
    orgId,
    loading,
    saving,
    error,
    saveNavConfig,
    refetch: fetchNavConfig,
  };
}
