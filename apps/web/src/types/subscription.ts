import type { AlumniBucket } from "@/types/database";

export interface SubscriptionInfo {
  bucket: AlumniBucket;
  alumniLimit: number | null;
  alumniCount: number;
  remaining: number | null;
  status: string;
  isEnterpriseManaged: boolean;
  stripeSubscriptionId: string | null;
  stripeCustomerId: string | null;
  currentPeriodEnd: string | null;
}
