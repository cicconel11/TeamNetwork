export type VendorId = "ics" | "vendorA" | "vendorB" | "generic_html";

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

export interface ScheduleConnector {
  id: VendorId;
  canHandle(input: { url: string; html?: string; headers?: Record<string, string> }): Promise<{
    ok: boolean;
    confidence: number;
    reason?: string;
  }>;
  preview(input: { url: string; orgId: string }): Promise<PreviewResult>;
  sync(input: { sourceId: string; orgId: string; url: string; window: { from: Date; to: Date } }): Promise<SyncResult>;
}
