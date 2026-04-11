import type { NormalizedConstituent, SyncResult } from "./types";
import { debugLog } from "@/lib/debug";

export function chunkArray<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

interface UpsertDeps {
  supabase: any;
  integrationId: string;
  organizationId: string;
  alumniLimit: number | null;
  currentAlumniCount: number;
}

/**
 * Upserts normalized constituents into the alumni table + alumni_external_ids.
 *
 * Conflict resolution:
 * - If external_id already mapped → update alumni record (preserve user-edited fields)
 * - Otherwise → create new alumni record (respecting quota)
 * - No email auto-merge in Phase 1 (deferred to Phase 2 claim flow)
 */
export async function upsertConstituents(
  deps: UpsertDeps,
  constituents: NormalizedConstituent[]
): Promise<SyncResult> {
  const { supabase, integrationId, organizationId, alumniLimit, currentAlumniCount } = deps;
  let created = 0;
  let updated = 0;
  let unchanged = 0;
  let skipped = 0;
  let runningCount = currentAlumniCount;

  for (const chunk of chunkArray(constituents, 50)) {
    for (const record of chunk) {
      try {
        // Step 1: Check if external ID already mapped
        const { data: existingMapping } = await supabase
          .from("alumni_external_ids")
          .select("id, alumni_id, last_synced_at")
          .eq("integration_id", integrationId)
          .eq("external_id", record.external_id)
          .maybeSingle();

        if (existingMapping) {
          // Update existing linked alumni — PRESERVE USER-EDITED FIELDS
          const { data: currentAlumni, error: alumniError } = await supabase
            .from("alumni")
            .select("id, first_name, last_name, email, phone_number, address_summary, graduation_year, updated_at")
            .eq("id", existingMapping.alumni_id)
            .is("deleted_at", null)
            .single();

          if (!currentAlumni && alumniError && alumniError.code !== "PGRST116") {
            // Transient DB error — skip this record, don't delete the mapping
            debugLog("blackbaud-storage", "transient alumni lookup error, skipping", {
              alumniId: existingMapping.alumni_id,
              externalId: record.external_id,
              error: alumniError.message,
              code: alumniError.code,
            });
            skipped += 1;
            continue;
          }

          if (!currentAlumni) {
            // Alumni row genuinely missing or soft-deleted (PGRST116 / no error) —
            // remove the stale mapping so this constituent falls through to create-new.
            await supabase
              .from("alumni_external_ids")
              .delete()
              .eq("id", existingMapping.id);
            debugLog("blackbaud-storage", "cleared stale mapping for soft-deleted alumni", {
              alumniId: existingMapping.alumni_id,
              externalId: record.external_id,
            });
            // Fall through to create-new path (no continue)
          } else {
            const lastSync = existingMapping.last_synced_at ? new Date(existingMapping.last_synced_at) : null;
            const alumniUpdatedAt = currentAlumni.updated_at ? new Date(currentAlumni.updated_at) : null;
            const userHasEdited = lastSync && alumniUpdatedAt && alumniUpdatedAt > lastSync;

            const updates: Record<string, unknown> = {};

            if (!userHasEdited) {
              // No user edits since last sync — safe to overwrite all fields
              updates.first_name = record.first_name;
              updates.last_name = record.last_name;
              updates.email = record.email;
              updates.phone_number = record.phone_number;
              updates.address_summary = record.address_summary;
              updates.graduation_year = record.graduation_year;
            } else {
              // User edited since last sync — only fill blank fields
              if (!currentAlumni.email && record.email) updates.email = record.email;
              if (!currentAlumni.phone_number && record.phone_number) updates.phone_number = record.phone_number;
              if (!currentAlumni.address_summary && record.address_summary) updates.address_summary = record.address_summary;
              if (!currentAlumni.graduation_year && record.graduation_year) updates.graduation_year = record.graduation_year;
            }

            // Only bump updated_at when actual fields change (prevents sticky provenance)
            const hasFieldChanges = Object.keys(updates).length > 0;
            if (!hasFieldChanges) { unchanged += 1; continue; }
            updates.updated_at = new Date().toISOString();

            const { error: updateError } = await supabase
              .from("alumni")
              .update(updates)
              .eq("id", existingMapping.alumni_id);

            if (updateError) {
              debugLog("blackbaud-storage", "update error", { alumniId: existingMapping.alumni_id, error: updateError.message });
              skipped += 1;
              continue;
            }

            // Refresh external_data and last_synced_at
            await supabase
              .from("alumni_external_ids")
              .update({
                external_data: record as unknown,
                last_synced_at: new Date().toISOString(),
              })
              .eq("id", existingMapping.id);

            updated += 1;
            continue;
          }
        }

        // Step 2: Create new alumni record (check quota first)
        if (alumniLimit !== null && runningCount >= alumniLimit) {
          skipped += 1;
          continue;
        }

        const { data: newAlumni, error: insertError } = await supabase
          .from("alumni")
          .insert({
            organization_id: organizationId,
            first_name: record.first_name,
            last_name: record.last_name,
            email: record.email,
            phone_number: record.phone_number,
            address_summary: record.address_summary,
            graduation_year: record.graduation_year,
            source: "integration_sync",
          })
          .select("id")
          .single();

        if (insertError) {
          debugLog("blackbaud-storage", "insert error", { record: record.external_id, error: insertError.message });
          skipped += 1;
          continue;
        }

        // Create external ID mapping — rollback alumni if this fails
        const { error: mappingError } = await supabase.from("alumni_external_ids").insert({
          alumni_id: newAlumni.id,
          integration_id: integrationId,
          external_id: record.external_id,
          external_data: record as unknown,
          last_synced_at: new Date().toISOString(),
        });

        if (mappingError) {
          debugLog("blackbaud-storage", "mapping insert failed, rolling back alumni", {
            alumniId: newAlumni.id,
            error: mappingError.message,
          });
          await supabase.from("alumni").delete().eq("id", newAlumni.id);
          skipped += 1;
          continue;
        }

        created += 1;
        runningCount += 1;
      } catch (err) {
        debugLog("blackbaud-storage", "record error", {
          external_id: record.external_id,
          error: err instanceof Error ? err.message : String(err),
        });
        skipped += 1;
      }
    }
  }

  return { ok: true, created, updated, unchanged, skipped };
}
