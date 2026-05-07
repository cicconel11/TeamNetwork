"use client";

import { useState, useEffect, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { uniqueStringsCaseInsensitive } from "@/lib/string-utils";

interface UseDistinctValuesOptions {
  orgId: string;
  table: "alumni" | "members";
  column: string;
  enabled?: boolean;
}

interface UseDistinctValuesResult {
  values: string[];
  isLoading: boolean;
  error: string | null;
  refetch: () => void;
}

export function useDistinctValues({
  orgId,
  table,
  column,
  enabled = true,
}: UseDistinctValuesOptions): UseDistinctValuesResult {
  const [values, setValues] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchValues = useCallback(async () => {
    if (!enabled || !orgId) return;

    setIsLoading(true);
    setError(null);

    try {
      const supabase = createClient();

      // Fetch all non-null values for the column
      const { data, error: fetchError } = await supabase
        .from(table)
        .select(column)
        .eq("organization_id", orgId)
        .not(column, "is", null);

      if (fetchError) {
        throw fetchError;
      }

      // Get unique values and filter out empty strings
      const uniqueValues = uniqueStringsCaseInsensitive(
        (data || []).map((row) => (row as unknown as Record<string, unknown>)[column] as string | null)
      ).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));

      setValues(uniqueValues);
    } catch (e) {
      const message = e instanceof Error ? e.message : "Failed to fetch values";
      setError(message);
      console.error(`Error fetching distinct ${column} values:`, e);
    } finally {
      setIsLoading(false);
    }
  }, [orgId, table, column, enabled]);

  useEffect(() => {
    fetchValues();
  }, [fetchValues]);

  return {
    values,
    isLoading,
    error,
    refetch: fetchValues,
  };
}

// Convenience hooks for common fields
export function useIndustries(orgId: string, enabled = true) {
  return useDistinctValues({ orgId, table: "alumni", column: "industry", enabled });
}

export function useCompanies(orgId: string, enabled = true) {
  return useDistinctValues({ orgId, table: "alumni", column: "current_company", enabled });
}

export function useCities(orgId: string, enabled = true) {
  return useDistinctValues({ orgId, table: "alumni", column: "current_city", enabled });
}

export function usePositions(orgId: string, enabled = true) {
  return useDistinctValues({ orgId, table: "alumni", column: "position_title", enabled });
}

export function useMajors(orgId: string, enabled = true) {
  return useDistinctValues({ orgId, table: "alumni", column: "major", enabled });
}

export function useGraduationYears(orgId: string, enabled = true) {
  const [years, setYears] = useState<number[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchYears = useCallback(async () => {
    if (!enabled || !orgId) return;

    setIsLoading(true);
    setError(null);

    try {
      const supabase = createClient();

      const { data, error: fetchError } = await supabase
        .from("alumni")
        .select("graduation_year")
        .eq("organization_id", orgId)
        .not("graduation_year", "is", null);

      if (fetchError) {
        throw fetchError;
      }

      const uniqueYears = [...new Set(
        (data || [])
          .map((row) => row.graduation_year)
          .filter((v): v is number => typeof v === "number")
      )].sort((a, b) => b - a); // Sort descending (most recent first)

      setYears(uniqueYears);
    } catch (e) {
      const message = e instanceof Error ? e.message : "Failed to fetch graduation years";
      setError(message);
      console.error("Error fetching graduation years:", e);
    } finally {
      setIsLoading(false);
    }
  }, [orgId, enabled]);

  useEffect(() => {
    fetchYears();
  }, [fetchYears]);

  return {
    years,
    isLoading,
    error,
    refetch: fetchYears,
  };
}
