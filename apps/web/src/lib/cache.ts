"use server";

import { revalidatePath, revalidateTag } from "next/cache";

export async function revalidatePaths(paths: string[]) {
  for (const path of paths) {
    revalidatePath(path);
  }
}

/**
 * Invalidate cached data for an organization by tag.
 * Call this from mutation routes/server actions.
 */
export async function invalidateOrgCache(orgId: string, ...cacheTypes: Array<"nav-config" | "org-settings" | "donation-stats">) {
  for (const type of cacheTypes) {
    revalidateTag(`${type}-${orgId}`);
  }
}
