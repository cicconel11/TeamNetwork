/** Serializable stat chip for client `OrgHomeMobileOverview` (no Lucide across RSC boundary). */
export type MobileStatIconKey = "users" | "graduation-cap" | "heart" | "calendar-clock" | "hand-heart";

export interface MobileStatChip {
  label: string;
  value: string;
  href: string;
  iconKey: MobileStatIconKey;
}
