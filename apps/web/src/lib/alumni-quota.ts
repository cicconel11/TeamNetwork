import type { AlumniBucket } from "@/types/database";

export const ALUMNI_LIMITS: Record<AlumniBucket, number | null> = {
  none: 0,
  "0-250": 250,
  "251-500": 500,
  "501-1000": 1000,
  "1001-2500": 2500,
  "2500-5000": 5000,
  "5000+": null,
};

export function getAlumniLimit(bucket: AlumniBucket | null | undefined) {
  if (!bucket || !(bucket in ALUMNI_LIMITS)) return 0;
  return ALUMNI_LIMITS[bucket];
}

export function normalizeBucket(bucket: string | null | undefined): AlumniBucket {
  const allowed: AlumniBucket[] = ["none", "0-250", "251-500", "501-1000", "1001-2500", "2500-5000", "5000+"];
  return allowed.includes(bucket as AlumniBucket) ? (bucket as AlumniBucket) : "none";
}
