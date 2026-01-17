import { useEffect, useState, useRef, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import { filterAnnouncementsForUser, ViewerContext } from "@teammeet/core";
import { normalizeRole } from "@teammeet/core";
import type { Announcement } from "@teammeet/types";

const STALE_TIME_MS = 30_000; // 30 seconds

interface UseAnnouncementsReturn {
  announcements: Announcement[];
  loading: boolean;
  error: string | null;
  refetch: () => void;
  refetchIfStale: () => void;
}

export function useAnnouncements(orgSlug: string): UseAnnouncementsReturn {
  const isMountedRef = useRef(true);
  const orgIdRef = useRef<string | null>(null);
  const lastFetchTimeRef = useRef<number>(0);
  const [orgId, setOrgId] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    orgIdRef.current = null;
    setOrgId(null);
    lastFetchTimeRef.current = 0;
  }, [orgSlug]);

  const fetchAnnouncements = useCallback(async (overrideOrgId?: string) => {
    if (!orgSlug) {
      if (isMountedRef.current) {
        setAnnouncements([]);
        setError(null);
        setLoading(false);
        orgIdRef.current = null;
        setOrgId(null);
      }
      return;
    }

    try {
      setLoading(true);

      // Get current user
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");
      if (isMountedRef.current) {
        setUserId(user.id);
      }

      let resolvedOrgId = overrideOrgId ?? orgIdRef.current;

      if (!resolvedOrgId) {
        // Get org ID from slug
        const { data: org, error: orgError } = await supabase
          .from("organizations")
          .select("id")
          .eq("slug", orgSlug)
          .single();

        if (orgError) throw orgError;
        resolvedOrgId = org.id;
        orgIdRef.current = resolvedOrgId;
        if (isMountedRef.current) {
          setOrgId(resolvedOrgId);
        }
      }

      // Get user's role in this org
      const { data: roleData } = await supabase
        .from("user_organization_roles")
        .select("role, status")
        .eq("organization_id", resolvedOrgId)
        .eq("user_id", user.id)
        .eq("status", "active")
        .single();

      // Fetch announcements
      const { data: announcementsData, error: announcementsError } = await supabase
        .from("announcements")
        .select("*")
        .eq("organization_id", resolvedOrgId)
        .is("deleted_at", null)
        .order("created_at", { ascending: false });

      if (announcementsError) throw announcementsError;

      // Filter based on audience targeting
      const ctx: ViewerContext = {
        role: normalizeRole(roleData?.role),
        status: roleData?.status ?? null,
        userId: user.id,
      };

      const filtered = filterAnnouncementsForUser(announcementsData, ctx);

      if (isMountedRef.current) {
        setAnnouncements(filtered);
        setError(null);
        lastFetchTimeRef.current = Date.now();
      }
    } catch (e) {
      if (isMountedRef.current) {
        setError((e as Error).message);
      }
    } finally {
      if (isMountedRef.current) {
        setLoading(false);
      }
    }
  }, [orgSlug]);

  useEffect(() => {
    isMountedRef.current = true;
    fetchAnnouncements();

    return () => {
      isMountedRef.current = false;
    };
  }, [fetchAnnouncements]);

  useEffect(() => {
    if (!orgId) return;
    const channel = supabase
      .channel(`announcements:${orgId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "announcements",
          filter: `organization_id=eq.${orgId}`,
        },
        () => {
          fetchAnnouncements(orgId);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [orgId, fetchAnnouncements]);

  useEffect(() => {
    if (!orgId || !userId) return;
    const channel = supabase
      .channel(`announcement-roles:${orgId}:${userId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "user_organization_roles",
          filter: `user_id=eq.${userId}`,
        },
        (payload) => {
          const nextOrgId = (payload.new as { organization_id?: string } | null)
            ?.organization_id;
          const previousOrgId = (payload.old as { organization_id?: string } | null)
            ?.organization_id;
          if (nextOrgId === orgId || previousOrgId === orgId) {
            fetchAnnouncements(orgId);
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [orgId, userId, fetchAnnouncements]);

  const refetchIfStale = useCallback(() => {
    const now = Date.now();
    if (now - lastFetchTimeRef.current > STALE_TIME_MS) {
      fetchAnnouncements();
    }
  }, [fetchAnnouncements]);

  return { announcements, loading, error, refetch: fetchAnnouncements, refetchIfStale };
}
