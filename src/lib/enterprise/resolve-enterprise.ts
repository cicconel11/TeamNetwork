import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { baseSchemas } from "@/lib/security/validation";

export interface ResolvedEnterpriseParam {
  enterpriseId: string;
  enterpriseSlug: string | null;
}

export type ResolveEnterpriseError = { message: string; status: number };

export async function resolveEnterpriseParam(
  idOrSlug: string,
  serviceSupabase: SupabaseClient<Database, "public">,
): Promise<{ data: ResolvedEnterpriseParam | null; error?: ResolveEnterpriseError }> {
  const idParsed = baseSchemas.uuid.safeParse(idOrSlug);
  if (idParsed.success) {
    return { data: { enterpriseId: idOrSlug, enterpriseSlug: null } };
  }

  const slugParsed = baseSchemas.slug.safeParse(idOrSlug);
  if (!slugParsed.success) {
    return { data: null, error: { message: "Invalid enterprise id", status: 400 } };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (serviceSupabase as any)
    .from("enterprises")
    .select("id, slug")
    .eq("slug", slugParsed.data)
    .maybeSingle() as { data: { id: string; slug: string } | null; error: Error | null };

  if (error) {
    console.error("[enterprise] Failed to resolve enterprise param", error);
    return { data: null, error: { message: "Failed to resolve enterprise", status: 500 } };
  }

  if (!data) {
    return { data: null, error: { message: "Enterprise not found", status: 404 } };
  }

  return {
    data: {
      enterpriseId: data.id,
      enterpriseSlug: data.slug,
    },
  };
}
