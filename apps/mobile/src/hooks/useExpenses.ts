import { useEffect, useState, useRef, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import type { Expense } from "@teammeet/types";

const STALE_TIME_MS = 30_000; // 30 seconds

interface UseExpensesReturn {
  expenses: Expense[];
  total: number;
  loading: boolean;
  error: string | null;
  refetch: () => void;
  refetchIfStale: () => void;
}

interface UseExpensesOptions {
  /** If true, fetch all expenses (admin view). If false, only current user's expenses. */
  isAdmin?: boolean;
}

export function useExpenses(
  orgSlug: string,
  options: UseExpensesOptions = {}
): UseExpensesReturn {
  const { isAdmin = false } = options;
  const isMountedRef = useRef(true);
  const orgIdRef = useRef<string | null>(null);
  const lastFetchTimeRef = useRef<number>(0);
  const [orgId, setOrgId] = useState<string | null>(null);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Reset state when org changes
  useEffect(() => {
    orgIdRef.current = null;
    setOrgId(null);
    lastFetchTimeRef.current = 0;
  }, [orgSlug]);

  const fetchExpenses = useCallback(
    async (overrideOrgId?: string) => {
      if (!orgSlug) {
        if (isMountedRef.current) {
          setExpenses([]);
          setError(null);
          setLoading(false);
          orgIdRef.current = null;
          setOrgId(null);
        }
        return;
      }

      try {
        setLoading(true);

        let resolvedOrgId = overrideOrgId ?? orgIdRef.current;

        if (!resolvedOrgId) {
          // First get org ID from slug
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

        // Build query
        let query = supabase
          .from("expenses")
          .select("*")
          .eq("organization_id", resolvedOrgId)
          .is("deleted_at", null)
          .order("created_at", { ascending: false });

        // Non-admin users only see their own expenses
        if (!isAdmin) {
          const {
            data: { user },
          } = await supabase.auth.getUser();
          if (user) {
            query = query.eq("user_id", user.id);
          }
        }

        const { data, error: expensesError } = await query;

        if (expensesError) {
          // If table doesn't exist, return empty array
          if (expensesError.code === "42P01") {
            if (isMountedRef.current) {
              setExpenses([]);
              setError(null);
            }
            return;
          }
          throw expensesError;
        }

        if (isMountedRef.current) {
          setExpenses((data as Expense[]) || []);
          setError(null);
          lastFetchTimeRef.current = Date.now();
        }
      } catch (e) {
        if (isMountedRef.current) {
          const error = e as { code?: string; message: string };
          if (
            error.code === "42P01" ||
            error.message?.includes("does not exist")
          ) {
            setExpenses([]);
            setError(null);
          } else {
            setError(error.message);
          }
        }
      } finally {
        if (isMountedRef.current) {
          setLoading(false);
        }
      }
    },
    [orgSlug, isAdmin]
  );

  // Initial fetch
  useEffect(() => {
    isMountedRef.current = true;
    fetchExpenses();

    return () => {
      isMountedRef.current = false;
    };
  }, [fetchExpenses]);

  // Real-time subscription for expenses table
  useEffect(() => {
    if (!orgId) return;
    const channel = supabase
      .channel(`expenses:${orgId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "expenses",
          filter: `organization_id=eq.${orgId}`,
        },
        () => {
          fetchExpenses(orgId);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [orgId, fetchExpenses]);

  const refetchIfStale = useCallback(() => {
    const now = Date.now();
    if (now - lastFetchTimeRef.current > STALE_TIME_MS) {
      fetchExpenses();
    }
  }, [fetchExpenses]);

  // Calculate total
  const total = expenses.reduce((sum, e) => sum + Number(e.amount), 0);

  return {
    expenses,
    total,
    loading,
    error,
    refetch: fetchExpenses,
    refetchIfStale,
  };
}
