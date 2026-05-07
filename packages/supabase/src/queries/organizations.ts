import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@teammeet/types";

type Organization = Database["public"]["Tables"]["organizations"]["Row"];

export interface FetchOrganizationsResult {
  data: Organization[] | null;
  error: Error | null;
}

/**
 * Fetches all organizations for a user based on their active memberships
 */
export async function fetchUserOrganizations(
  supabase: SupabaseClient<Database>,
  userId: string
): Promise<FetchOrganizationsResult> {
  try {
    const { data, error } = await supabase
      .from("user_organization_roles")
      .select("organization:organizations(*)")
      .eq("user_id", userId)
      .eq("status", "active");

    if (error) throw error;

    const organizations = (data || [])
      .map((row) => row.organization)
      .filter((org): org is Organization => org !== null);

    return { data: organizations, error: null };
  } catch (e) {
    return { data: null, error: e as Error };
  }
}

/**
 * Fetches a single organization by its slug
 */
export async function fetchOrganizationBySlug(
  supabase: SupabaseClient<Database>,
  slug: string
): Promise<{ data: Organization | null; error: Error | null }> {
  try {
    const { data, error } = await supabase
      .from("organizations")
      .select("*")
      .eq("slug", slug)
      .single();

    if (error) throw error;
    return { data, error: null };
  } catch (e) {
    return { data: null, error: e as Error };
  }
}

/**
 * Fetches organization ID from slug
 */
export async function fetchOrganizationIdBySlug(
  supabase: SupabaseClient<Database>,
  slug: string
): Promise<{ data: string | null; error: Error | null }> {
  try {
    const { data, error } = await supabase
      .from("organizations")
      .select("id")
      .eq("slug", slug)
      .single();

    if (error) throw error;
    return { data: data?.id ?? null, error: null };
  } catch (e) {
    return { data: null, error: e as Error };
  }
}
