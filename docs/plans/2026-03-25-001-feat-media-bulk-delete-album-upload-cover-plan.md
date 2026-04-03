---
title: "feat: Media bulk delete, album cover upload, and upload-to-album fix"
type: feat
status: active
date: 2026-03-25
---

# Media: Bulk Delete, Album Cover, Upload-to-Album Fix

## Context

Three improvements to the media gallery:
1. **Bulk delete** -- select mode exists (floating bar with "Add to album") but has no delete action
2. **Album cover upload** -- `cover_media_id` column and PATCH endpoint exist but no UI to set it
3. **Upload-to-album bug** -- uploading while viewing an album adds photos to general pool instead of the album

## Feature 1: Bulk Delete Photos

### API: `src/app/api/media/bulk-delete/route.ts` (new)

Follow the alumni bulk-delete pattern (`src/app/api/organizations/[organizationId]/alumni/bulk-delete/route.ts`):

```
POST /api/media/bulk-delete
Body: { orgId: uuid, mediaIds: uuid[1..100] }
Response: { deleted: number, deletedIds: string[] }
```

- Auth: admin OR uploader of ALL items in the batch (query `media_items` to verify `uploaded_by`)
- Soft delete: `.update({ deleted_at }).in("id", mediaIds).eq("organization_id", orgId).is("deleted_at", null)`
- Rate limit: `{ feature: "media-bulk-delete", limitPerIp: 20, limitPerUser: 10 }`
- Read-only guard via `checkOrgReadOnly(orgId)`

### UI: `src/components/media/MediaGallery.tsx`

- Add `bulkDeleting` and `showBulkDeleteConfirm` state
- Add `handleBulkDelete()`: calls API, removes deleted IDs from `items`, exits select mode, shows feedback toast
- Floating action bar (line ~493): add "Delete" button with danger variant
  - Show only when user can delete all selected items (admin OR uploader of all)
  - Two-click confirm: first click shows "Confirm delete (N)", second triggers delete
  - Reset confirm state when selection changes

### Edge cases
- Concurrent deletion: use `deletedIds` from response (not request) to update local state
- Mixed ownership as non-admin: hide Delete button client-side; server enforces authz

---

## Feature 2: Album Cover Photo

### UI: `src/components/media/AlbumView.tsx`

- Add "Set cover" button in header (visible when `canEdit && items.length > 0`)
- Opens `CoverPickerModal` showing album items as selectable grid

### New component: `src/components/media/CoverPickerModal.tsx`

- Props: `items: MediaItem[]`, `currentCoverId: string | null`, `onSelect: (id, url) => void`, `onClose: () => void`, `saving: boolean`
- Grid of thumbnails, highlight current cover, click to select

### On selection:
- Call `PATCH /api/media/albums/${album.id}` with `{ orgId, cover_media_id: selectedId }` (endpoint already exists)
- Call `onAlbumUpdated?.({ cover_media_id, cover_url })` to update parent state
- `AlbumCard.tsx` already renders `cover_url`

### Edge cases
- Empty album: hide "Set cover" button
- Cover item later deleted: AlbumCard falls back to placeholder (pre-existing behavior)

---

## Feature 3 (Bug Fix): Upload Directly to Album

### Root cause
`MediaUploadPanel` has no concept of a target album. Uploads always go to the general media pool. The only album-creation flow is the post-upload `pendingAlbumName` effect.

### Fix: `src/components/media/MediaUploadPanel.tsx`

- Add props: `targetAlbumId?: string`, `targetAlbumName?: string`
- When `targetAlbumId` is set:
  - Show "Uploading to [albumName]" in header
  - Suppress folder-creates-album flow (skip `setPendingAlbumName` in `handleFolder`)
  - Pass `targetAlbumId` to `useGalleryUpload`

### Fix: `src/hooks/useGalleryUpload.ts`

- Add `targetAlbumId?: string` to options
- After `MARK_DONE` dispatch + `onFileComplete` callback, if `targetAlbumId` is set:
  ```ts
  fetch(`/api/media/albums/${targetAlbumId}/items`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ orgId, mediaIds: [mediaId] }),
  }).catch(() => {}); // best-effort
  ```
- The existing `POST /api/media/albums/[albumId]/items` handles single-item arrays and deduplicates via upsert

### Fix: `src/components/media/AlbumView.tsx`

- Destructure `canUpload` prop (already passed but unused)
- Add `showUpload` state + "Upload" button in header
- Render own `MediaUploadPanel` with `targetAlbumId={album.id}` and `targetAlbumName={album.name}`
- `onFileComplete`: add optimistic item to local `items` state

### Fix: `src/components/media/MediaGallery.tsx`

- Hide global upload panel when `selectedAlbum` is set (AlbumView renders its own)
- OR: pass `targetAlbumId={selectedAlbum?.id}` to the existing panel

---

## Implementation Order

1. **Feature 1 (Bulk Delete)** -- standalone, no dependencies
2. **Feature 3 (Upload-to-Album)** -- standalone, no dependencies
3. **Feature 2 (Album Cover)** -- benefits from F3 but independent

Features 1 and 3 can be done in parallel.

## File Change Summary

| File | Action | Feature |
|------|--------|---------|
| `src/app/api/media/bulk-delete/route.ts` | Create | F1 |
| `src/components/media/MediaGallery.tsx` | Modify | F1, F3 |
| `src/components/media/MediaUploadPanel.tsx` | Modify | F3 |
| `src/hooks/useGalleryUpload.ts` | Modify | F3 |
| `src/components/media/AlbumView.tsx` | Modify | F2, F3 |
| `src/components/media/CoverPickerModal.tsx` | Create | F2 |

## Verification

### Automated
- `tests/media-bulk-delete.test.ts`: schema validation, auth (admin/uploader/forbidden), soft delete, org scoping, idempotency
- `tests/media-upload-to-album.test.ts`: album-add called after MARK_DONE when targetAlbumId set, suppressed when not set

### Manual
- [ ] Select 5 photos > Delete > confirm > verify removed from grid
- [ ] Non-admin selects mix of own + others' > verify Delete hidden
- [ ] Open album > Upload 3 photos > verify they appear in album (not just All Photos)
- [ ] Open album > Set cover > pick photo > go to Albums grid > verify cover displays
- [ ] Folder upload from album view: files added to existing album, no new album created
