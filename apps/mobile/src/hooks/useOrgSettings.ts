import { useEffect, useState, useRef, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import { fetchWithAuth } from "@/lib/web-api";

export interface OrgSettings {
  id: string;
  name: string;
  slug: string;
  logo_url: string | null;
  primary_color: string | null;
  secondary_color: string | null;
}

interface UseOrgSettingsReturn {
  org: OrgSettings | null;
  loading: boolean;
  error: string | null;
  updateName: (name: string) => Promise<{ success: boolean; error?: string }>;
  updateBranding: (data: {
    primaryColor?: string;
    secondaryColor?: string;
    logo?: { uri: string; name: string; type: string };
  }) => Promise<{ success: boolean; error?: string }>;
  refetch: () => Promise<void>;
}

export function useOrgSettings(orgSlug: string | null): UseOrgSettingsReturn {
  const isMountedRef = useRef(true);
  const [org, setOrg] = useState<OrgSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchOrg = useCallback(async () => {
    if (!orgSlug) {
      setOrg(null);
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);

      const { data, error: fetchError } = await supabase
        .from("organizations")
        .select("id, name, slug, logo_url, primary_color, secondary_color")
        .eq("slug", orgSlug)
        .single();

      if (fetchError) throw fetchError;

      if (isMountedRef.current) {
        setOrg(data);
        setError(null);
      }
    } catch (e) {
      if (isMountedRef.current) {
        setError((e as Error).message);
        setOrg(null);
      }
    } finally {
      if (isMountedRef.current) {
        setLoading(false);
      }
    }
  }, [orgSlug]);

  // Initial fetch
  useEffect(() => {
    isMountedRef.current = true;
    fetchOrg();

    return () => {
      isMountedRef.current = false;
    };
  }, [fetchOrg]);

  // Realtime subscription
  useEffect(() => {
    if (!org?.id) return;

    const channel = supabase
      .channel(`org-settings:${org.id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "organizations",
          filter: `id=eq.${org.id}`,
        },
        () => {
          fetchOrg();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [org?.id, fetchOrg]);

  const updateName = useCallback(
    async (name: string): Promise<{ success: boolean; error?: string }> => {
      if (!org?.id) {
        return { success: false, error: "Organization not loaded" };
      }

      try {
        const response = await fetchWithAuth(`/api/organizations/${org.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: name.trim() }),
        });

        const data = await response.json().catch(() => null);

        if (!response.ok) {
          throw new Error(data?.error || "Unable to update organization name");
        }

        // Optimistically update local state
        if (isMountedRef.current && data?.name) {
          setOrg((prev) => (prev ? { ...prev, name: data.name } : prev));
        }

        return { success: true };
      } catch (e) {
        return { success: false, error: (e as Error).message };
      }
    },
    [org?.id]
  );

  const updateBranding = useCallback(
    async (data: {
      primaryColor?: string;
      secondaryColor?: string;
      logo?: { uri: string; name: string; type: string };
    }): Promise<{ success: boolean; error?: string }> => {
      if (!org?.id) {
        return { success: false, error: "Organization not loaded" };
      }

      try {
        const formData = new FormData();

        if (data.primaryColor) {
          formData.append("primaryColor", data.primaryColor);
        }
        if (data.secondaryColor) {
          formData.append("secondaryColor", data.secondaryColor);
        }
        if (data.logo) {
          formData.append("logo", {
            uri: data.logo.uri,
            name: data.logo.name,
            type: data.logo.type,
          } as unknown as Blob);
        }

        const response = await fetchWithAuth(
          `/api/organizations/${org.id}/branding`,
          {
            method: "POST",
            body: formData,
          }
        );

        const responseData = await response.json().catch(() => null);

        if (!response.ok) {
          throw new Error(responseData?.error || "Unable to update branding");
        }

        // Optimistically update local state
        if (isMountedRef.current && responseData?.organization) {
          const updated = responseData.organization;
          setOrg((prev) =>
            prev
              ? {
                  ...prev,
                  logo_url: updated.logo_url ?? prev.logo_url,
                  primary_color: updated.primary_color ?? prev.primary_color,
                  secondary_color:
                    updated.secondary_color ?? prev.secondary_color,
                }
              : prev
          );
        }

        return { success: true };
      } catch (e) {
        return { success: false, error: (e as Error).message };
      }
    },
    [org?.id]
  );

  return { org, loading, error, updateName, updateBranding, refetch: fetchOrg };
}
