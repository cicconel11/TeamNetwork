import { useEffect, useState, useRef, useCallback } from "react";
import { supabase, createPostgresChangesChannel} from "@/lib/supabase";
import { showToast } from "@/components/ui/Toast";
import * as sentry from "@/lib/analytics/sentry";
import type { Expense } from "@teammeet/types";
import { useAuth } from "@/hooks/useAuth";
import { useRequestTracker } from "@/hooks/useRequestTracker";

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
  orgId: string | null,
  options: UseExpensesOptions = {}
): UseExpensesReturn {
  const { isAdmin = false } = options;
  const { user } = useAuth();
  const isMountedRef = useRef(true);
  const lastFetchTimeRef = useRef<number>(0);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { beginRequest, invalidateRequests, isCurrentRequest } = useRequestTracker();
  const userId = user?.id ?? null;

  useEffect(() => {
    invalidateRequests();
    setExpenses([]);
    setError(null);
    lastFetchTimeRef.current = 0;
  }, [orgId, userId, isAdmin, invalidateRequests]);

  const fetchExpenses = useCallback(
    async () => {
      const requestId = beginRequest();

      if (!orgId || (!isAdmin && !userId)) {
        if (isMountedRef.current) {
          setExpenses([]);
          setError(null);
          setLoading(false);
        }
        return;
      }

      try {
        setLoading(true);

        // Build query
        let query = supabase
          .from("expenses")
          .select("*")
          .eq("organization_id", orgId)
          .is("deleted_at", null)
          .order("created_at", { ascending: false });

        // Non-admin users only see their own expenses
        if (!isAdmin && userId) {
          query = query.eq("user_id", userId);
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

        if (isMountedRef.current && isCurrentRequest(requestId)) {
          setExpenses((data as Expense[]) || []);
          setError(null);
          lastFetchTimeRef.current = Date.now();
        }
      } catch (e) {
        if (isMountedRef.current && isCurrentRequest(requestId)) {
          const error = e as { code?: string; message: string };
          if (
            error.code === "42P01" ||
            error.message?.includes("does not exist")
          ) {
            setExpenses([]);
            setError(null);
          } else {
            const message = error.message || "An error occurred";
            setError(message);
            showToast(message, "error");
            sentry.captureException(e as Error, {
              context: "useExpenses",
              orgId,
            });
          }
        }
      } finally {
        if (isMountedRef.current && isCurrentRequest(requestId)) {
          setLoading(false);
        }
      }
    },
    [beginRequest, isAdmin, isCurrentRequest, orgId, userId]
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
    const channel = createPostgresChangesChannel(`expenses:${orgId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "expenses",
          filter: `organization_id=eq.${orgId}`,
        },
        () => {
          fetchExpenses();
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
