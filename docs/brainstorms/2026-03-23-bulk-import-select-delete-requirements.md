---
date: 2026-03-23
topic: bulk-import-select-delete
---

# Bulk Import: Select & Delete Alumni

## Problem Frame
Admins who bulk-import alumni (CSV or LinkedIn) currently have no way to exclude specific rows before committing, and no way to undo specific records after import. Mistakes (wrong spreadsheet, duplicate data, test imports) require manual one-by-one deletion from individual alumni profiles.

## Requirements

### Preview-stage row exclusion
- R1. The preview table (CSV and LinkedIn importers) shows a checkbox on each row, all checked by default
- R2. Admins can uncheck individual rows to exclude them from the import — unchecked rows are not sent to the API
- R3. A "select all / deselect all" checkbox in the table header toggles all non-invalid rows
- R4. The import button count and preview summary update live as rows are checked/unchecked

### Import history & batch deletion
- R5. Each import operation is tagged with a batch ID (stored on the alumni record) so records can be traced back to their import
- R6. An "Import History" view (accessible from the alumni page, admin-only) lists past import batches with: date, method (CSV/LinkedIn), record count, who imported
- R7. Clicking into a batch shows the individual alumni records from that import
- R8. Admins can select individual records within a batch and soft-delete them (sets `deleted_at`)

### Alumni directory multi-select deletion
- R9. The alumni directory gains a "Select" mode toggle (admin-only) that shows checkboxes on each alumni card
- R10. In select mode, a floating action bar appears with: selected count, "Delete selected" button, "Cancel" button
- R11. Deletion is soft-delete (`deleted_at` timestamp), consistent with existing patterns
- R12. A confirmation dialog appears before deletion, showing the count of records to be deleted

## Success Criteria
- An admin can upload a CSV, deselect 3 rows in preview, and import only the remaining rows
- An admin can find a past import batch, select specific records from it, and soft-delete them
- An admin can multi-select alumni from the directory and soft-delete them in bulk
- No new hard-delete paths are introduced

## Scope Boundaries
- No "undo/restore" UI for soft-deleted records (existing `deleted_at` filtering handles hiding)
- No batch deletion API for non-admin roles
- No changes to the LinkedIn single-attacher flow
- Import history is read-only (no re-importing or editing past batches)

## Key Decisions
- **Soft delete over hard delete**: Consistent with existing patterns, recoverable, lower risk
- **Batch ID on alumni records**: Lightweight approach — a nullable `import_batch_id` column rather than a separate join table
- **Both views for post-import deletion**: Import history for batch-oriented review, directory checkboxes for ad-hoc cleanup

## Outstanding Questions

### Deferred to Planning
- [Affects R5][Technical] Should `import_batch_id` be a UUID generated client-side or server-side? What metadata should the batch record store?
- [Affects R6][Needs research] Where should the Import History view live — a tab on the alumni page, a separate route, or a modal?
- [Affects R9][Technical] Should the select mode use client-side state or URL params for persistence across page navigation?
- [Affects R8, R11][Technical] Should batch deletion use a single RPC call or individual soft-delete calls?

## Next Steps
→ `/ce:plan` for structured implementation planning
