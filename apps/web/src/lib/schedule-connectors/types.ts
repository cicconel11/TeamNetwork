import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

export type VendorId = "ics" | "vendorA" | "vendorB" | "generic_html" | "google_calendar" | "outlook_calendar";

export type NormalizedEvent = {
  external_uid: string;
  title: string;
  start_at: string;
  end_at: string;
  location?: string;
  status?: "confirmed" | "cancelled" | "tentative";
  raw?: unknown;
};

export type PreviewResult = {
  vendor: VendorId;
  title?: string;
  events: NormalizedEvent[];
  inferredMeta?: Record<string, unknown>;
};

export type SyncResult = {
  imported: number;
  updated: number;
  cancelled: number;
  vendor: VendorId;
};

/** Optional fields used by OAuth-backed calendar connectors (ignored by others). */
export type CalendarConnectorDeps = {
  userId?: string;
  supabase?: SupabaseClient<Database>;
  fetcher?: typeof fetch;
  getAccessToken?: (supabase: SupabaseClient<Database>, userId: string) => Promise<string | null>;
};

export type GoogleConnectorDeps = CalendarConnectorDeps;

export type PreviewInput = { url: string; orgId: string } & CalendarConnectorDeps;
export type SyncInput = { sourceId: string; orgId: string; url: string; window: { from: Date; to: Date } } & CalendarConnectorDeps;

export interface ScheduleConnector {
  id: VendorId;
  canHandle(input: { url: string; html?: string; headers?: Record<string, string> }): Promise<{
    ok: boolean;
    confidence: number;
    reason?: string;
  }>;
  preview(input: PreviewInput): Promise<PreviewResult>;
  sync(input: SyncInput): Promise<SyncResult>;
}
