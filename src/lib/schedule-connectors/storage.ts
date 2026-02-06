import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/types/database";
import type { NormalizedEvent } from "./types";
import { debugLog } from "@/lib/debug";

export type SyncWindow = { from: Date; to: Date };

type ExistingEvent = {
  id: string;
  external_uid: string;
  status: string | null;
};

export function dedupeEvents(events: NormalizedEvent[]) {
  const map = new Map<string, NormalizedEvent>();
  for (const event of events) {
    map.set(event.external_uid, event);
  }
  return Array.from(map.values());
}

export async function syncScheduleEvents(
  supabase: SupabaseClient<Database>,
  input: {
    orgId: string;
    sourceId: string;
    events: NormalizedEvent[];
    window: SyncWindow;
    now?: Date;
  }
) {
  const now = input.now ?? new Date();
  const fromIso = input.window.from.toISOString();
  const toIso = input.window.to.toISOString();

  const rawCount = input.events.length;
  const dedupedAll = dedupeEvents(input.events);
  const dedupDropCount = rawCount - dedupedAll.length;
  if (dedupDropCount > 0) {
    const seen = new Set<string>();
    for (const event of input.events) {
      if (seen.has(event.external_uid)) {
        debugLog("schedule-sync", "dedup drop", {
          external_uid: event.external_uid,
          title: event.title,
          start_at: event.start_at,
        });
      }
      seen.add(event.external_uid);
    }
  }

  const deduped = dedupedAll
    .filter((event) => {
      const start = new Date(event.start_at);
      const inWindow = start >= input.window.from && start <= input.window.to;
      if (!inWindow) {
        debugLog("schedule-sync", "window filter drop", {
          external_uid: event.external_uid,
          start_at: event.start_at,
          windowFrom: input.window.from.toISOString(),
          windowTo: input.window.to.toISOString(),
        });
      }
      return inWindow;
    })
    .map((event) => ensureEndAt(event));

  const windowFilteredOut = dedupedAll.length - deduped.length;
  debugLog("schedule-sync", "syncScheduleEvents dedup+filter", {
    sourceId: input.sourceId,
    rawEventCount: rawCount,
    dedupedCount: dedupedAll.length,
    dedupDropped: dedupDropCount,
    afterWindowFilter: deduped.length,
    windowFilteredOut,
  });

  const { data: existing, error: existingError } = await supabase
    .from("schedule_events")
    .select("id, external_uid, status")
    .eq("source_id", input.sourceId)
    .gte("start_at", fromIso)
    .lte("start_at", toIso);

  if (existingError) {
    throw new Error(existingError.message);
  }

  const existingRows = (existing || []) as ExistingEvent[];
  const existingCancelledCount = existingRows.filter((r) => r.status === "cancelled").length;
  debugLog("schedule-sync", "existing events loaded", {
    existingCount: existingRows.length,
    existingCancelledCount,
  });
  const existingMap = new Map(existingRows.map((row) => [row.external_uid, row]));
  const nextSet = new Set(deduped.map((event) => event.external_uid));

  let imported = 0;
  let updated = 0;

  for (const event of deduped) {
    if (existingMap.has(event.external_uid)) {
      updated += 1;
    } else {
      imported += 1;
    }
  }

  if (deduped.length > 0) {
    const rows = deduped.map((event) => ({
      org_id: input.orgId,
      source_id: input.sourceId,
      external_uid: event.external_uid,
      title: event.title,
      start_at: event.start_at,
      end_at: event.end_at,
      location: event.location ?? null,
      status: event.status ?? "confirmed",
      raw: (event.raw ?? {}) as Json,
      updated_at: now.toISOString(),
    }));

    for (const chunk of chunkArray(rows, 200)) {
      const { error: upsertError } = await supabase
        .from("schedule_events")
        .upsert(chunk, { onConflict: "source_id,external_uid" });

      if (upsertError) {
        throw new Error(upsertError.message);
      }
    }
  }

  const toCancel = existingRows
    .filter((row) => !nextSet.has(row.external_uid))
    .filter((row) => row.status !== "cancelled")
    .map((row) => row.external_uid);

  let cancelled = 0;
  for (const chunk of chunkArray(toCancel, 250)) {
    if (chunk.length === 0) continue;
    const { error: cancelError } = await supabase
      .from("schedule_events")
      .update({ status: "cancelled", updated_at: now.toISOString() })
      .eq("source_id", input.sourceId)
      .in("external_uid", chunk);

    if (cancelError) {
      throw new Error(cancelError.message);
    }

    cancelled += chunk.length;
  }

  debugLog("schedule-sync", "syncScheduleEvents result", { imported, updated, cancelled });
  return { imported, updated, cancelled };
}

function ensureEndAt(event: NormalizedEvent) {
  if (event.end_at) {
    return event;
  }

  const start = new Date(event.start_at);
  const end = new Date(start.getTime() + 60 * 60 * 1000);
  return {
    ...event,
    end_at: end.toISOString(),
  };
}

function chunkArray<T>(items: T[], size: number) {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}
