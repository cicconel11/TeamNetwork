import { useCallback, useEffect, useRef, useState } from "react";
import { supabase, createPostgresChangesChannel} from "@/lib/supabase";
import * as sentry from "@/lib/analytics/sentry";
import type { ParentFormValues, ParentRecord } from "@/lib/parents";
import { buildParentPayload } from "@/lib/parents";

const STALE_TIME_MS = 30_000;

const PARENT_COLUMNS =
  "id, user_id, first_name, last_name, email, phone_number, photo_url, linkedin_url, student_name, relationship, notes, created_at, updated_at";

export async function fetchParentDetail(orgId: string, parentId: string): Promise<ParentRecord> {
  const { data, error } = await supabase
    .from("parents")
    .select(PARENT_COLUMNS)
    .eq("organization_id", orgId)
    .eq("id", parentId)
    .is("deleted_at", null)
    .single();

  if (error) throw error;
  if (!data) throw new Error("Parent not found");
  return data as ParentRecord;
}

interface UseParentsReturn {
  parents: ParentRecord[];
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
  refetchIfStale: () => void;
  createParent: (values: ParentFormValues) => Promise<{ success: boolean; parent?: ParentRecord; error?: string }>;
  updateParent: (parentId: string, values: ParentFormValues) => Promise<{ success: boolean; parent?: ParentRecord; error?: string }>;
  deleteParent: (parentId: string) => Promise<{ success: boolean; error?: string }>;
}

export function useParents(orgId: string | null, enabled: boolean): UseParentsReturn {
  const isMountedRef = useRef(true);
  const lastFetchTimeRef = useRef(0);
  const [parents, setParents] = useState<ParentRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    lastFetchTimeRef.current = 0;
  }, [orgId, enabled]);

  const fetchParents = useCallback(async () => {
    if (!orgId || !enabled) {
      if (isMountedRef.current) {
        setParents([]);
        setLoading(false);
        setError(null);
      }
      return;
    }

    try {
      setLoading(true);
      const { data, error: fetchError } = await supabase
        .from("parents")
        .select(PARENT_COLUMNS)
        .eq("organization_id", orgId)
        .is("deleted_at", null)
        .order("last_name", { ascending: true });

      if (fetchError) throw fetchError;

      if (isMountedRef.current) {
        setParents((data as ParentRecord[] | null) ?? []);
        setError(null);
        lastFetchTimeRef.current = Date.now();
      }
    } catch (e) {
      sentry.captureException(e as Error, { context: "useParents.fetchParents", orgId });
      if (isMountedRef.current) {
        setError((e as Error).message);
        setParents([]);
      }
    } finally {
      if (isMountedRef.current) {
        setLoading(false);
      }
    }
  }, [orgId, enabled]);

  useEffect(() => {
    isMountedRef.current = true;
    fetchParents();

    return () => {
      isMountedRef.current = false;
    };
  }, [fetchParents]);

  useEffect(() => {
    if (!orgId || !enabled) return;

    const channel = createPostgresChangesChannel(`parents:${orgId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "parents",
          filter: `organization_id=eq.${orgId}`,
        },
        () => {
          fetchParents();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [orgId, enabled, fetchParents]);

  const createParent = useCallback(
    async (values: ParentFormValues) => {
      if (!orgId) return { success: false, error: "Organization not loaded" };

      try {
        const { data, error: insertError } = await supabase
          .from("parents")
          .insert({ organization_id: orgId, ...buildParentPayload(values) })
          .select(PARENT_COLUMNS)
          .single();

        if (insertError) throw insertError;
        if (!data) throw new Error("Failed to create parent");

        const created = data as ParentRecord;
        if (isMountedRef.current) {
          setParents((prev) =>
            [...prev, created].sort((a, b) =>
              `${a.last_name} ${a.first_name}`.localeCompare(`${b.last_name} ${b.first_name}`)
            )
          );
        }
        return { success: true, parent: created };
      } catch (e) {
        sentry.captureException(e as Error, { context: "useParents.createParent", orgId });
        return { success: false, error: (e as Error).message };
      }
    },
    [orgId]
  );

  const updateParent = useCallback(
    async (parentId: string, values: ParentFormValues) => {
      if (!orgId) return { success: false, error: "Organization not loaded" };

      try {
        const { data, error: updateError } = await supabase
          .from("parents")
          .update(buildParentPayload(values))
          .eq("id", parentId)
          .eq("organization_id", orgId)
          .select(PARENT_COLUMNS)
          .single();

        if (updateError) throw updateError;
        if (!data) throw new Error("Failed to update parent");

        const updated = data as ParentRecord;
        if (isMountedRef.current) {
          setParents((prev) => prev.map((parent) => (parent.id === parentId ? updated : parent)));
        }
        return { success: true, parent: updated };
      } catch (e) {
        sentry.captureException(e as Error, { context: "useParents.updateParent", orgId, parentId });
        return { success: false, error: (e as Error).message };
      }
    },
    [orgId]
  );

  const deleteParent = useCallback(
    async (parentId: string) => {
      if (!orgId) return { success: false, error: "Organization not loaded" };

      try {
        const { error: deleteError } = await supabase
          .from("parents")
          .update({ deleted_at: new Date().toISOString() })
          .eq("id", parentId)
          .eq("organization_id", orgId);

        if (deleteError) throw deleteError;

        if (isMountedRef.current) {
          setParents((prev) => prev.filter((parent) => parent.id !== parentId));
        }
        return { success: true };
      } catch (e) {
        sentry.captureException(e as Error, { context: "useParents.deleteParent", orgId, parentId });
        return { success: false, error: (e as Error).message };
      }
    },
    [orgId]
  );

  const refetchIfStale = useCallback(() => {
    const now = Date.now();
    if (now - lastFetchTimeRef.current > STALE_TIME_MS) {
      fetchParents();
    }
  }, [fetchParents]);

  return {
    parents,
    loading,
    error,
    refetch: fetchParents,
    refetchIfStale,
    createParent,
    updateParent,
    deleteParent,
  };
}
