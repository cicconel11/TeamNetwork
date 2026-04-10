---
name: Mobile Forms Tab
overview: Implement a native mobile Forms tab that displays forms and document forms with real-time sync from Supabase, mirroring the web version's functionality.
todos:
  - id: hook
    content: Create useForms hook with real-time subscriptions
    status: completed
  - id: list-screen
    content: Create Forms list screen with gradient header and form cards
    status: completed
  - id: form-detail
    content: Create questionnaire form detail screen with field rendering
    status: completed
  - id: document-detail
    content: Create document form detail screen with download/upload
    status: completed
  - id: drawer-nav
    content: Update DrawerContent to navigate in-app instead of web
    status: completed
isProject: false
---

# Mobile Forms Tab Implementation

## Overview

Create a native Forms screen in the mobile app that mirrors the web versionn (`[apps/web/src/app/[orgSlug]/forms/page.tsx](apps/web/src/app/[orgSlug]/forms/page.tsx)`), displaying both questionnaire forms and document forms with real-time synchronization via Supabase subscriptions.

## Data Model

The forms feature uses 4 database tables:

- `forms` - Questionnaire form definitions (title, description, fields)
- `form_submissions` - User's responses to questionnaire forms
- `form_documents` - Document forms that users download, fill, and re-upload
- `form_document_submissions` - User's uploaded document submissions

Types are already exported from `@teammeet/types`:

```typescript
Form, FormSubmission, FormDocument, FormDocumentSubmission, FormField
```

## Implementation

### 1. Create `useForms` Hook

**File:** `apps/mobile/src/hooks/useForms.ts`

Following the pattern from `[apps/mobile/src/hooks/useEvents.ts](apps/mobile/src/hooks/useEvents.ts)`:

- Fetch active forms and form documents for the organization
- Fetch user's submissions to track "Submitted" status
- Set up Supabase realtime subscriptions on `forms`, `form_documents`, `form_submissions`, and `form_document_submissions` tables
- Implement stale time tracking with `refetch()` and `refetchIfStale()`

Returns:

```typescript
{
  forms: Form[];
  formDocuments: FormDocument[];
  submittedFormIds: Set<string>;
  submittedDocIds: Set<string>;
  loading: boolean;
  error: string | null;
  refetch: () => void;
  refetchIfStale: () => void;
}
```

### 2. Create Forms Screen

**File:** `apps/mobile/app/(app)/(drawer)/[orgSlug]/forms/index.tsx`

Following the UI pattern from `[apps/mobile/app/(app)/(drawer)/[orgSlug]/(tabs)/announcements.tsx](apps/mobile/app/(app)`/(drawer)/[orgSlug]/(tabs)/announcements.tsx):

- Gradient header with org logo (opens drawer) and title "Forms"
- Admin overflow menu with "Open in Web" option
- Content sheet with rounded corners
- Two sections:
  1. **Questionnaire Forms** - Cards showing form title, description, field count, and "Submitted" badge
  2. **Document Forms** - Cards with PDF icon, title, description, and "Submitted" badge
- Empty state when no forms available
- Pull-to-refresh via RefreshControl
- Navigation to form detail screens

### 3. Create Form Detail Screen (Questionnaire)

**File:** `apps/mobile/app/(app)/(drawer)/[orgSlug]/forms/[formId].tsx`

Mirrors `[apps/web/src/app/[orgSlug]/forms/[formId]/page.tsx](apps/web/src/app/[orgSlug]/forms/[formId]/page.tsx)`:

- Display form title and description
- Render form fields based on `field.type`:
  - text, textarea, email, phone, date (TextInput)
  - select (Picker or ActionSheet)
  - radio (RadioButton group)
  - checkbox (Checkbox group)
- Handle required field validation
- Submit/update responses to `form_submissions` table
- Success state with confirmation

### 4. Create Document Form Detail Screen

**File:** `apps/mobile/app/(app)/(drawer)/[orgSlug]/forms/documents/[documentId].tsx`

Mirrors `[apps/web/src/app/[orgSlug]/forms/documents/[documentId]/page.tsx](apps/web/src/app/[orgSlug]/forms/documents/[documentId]/page.tsx)`:

- Step 1: Download button (opens signed URL in browser via Linking)
- Step 2: File upload using expo-document-picker
- Upload to Supabase storage, create submission record
- Success state

### 5. Update Drawer Navigation

**File:** `[apps/mobile/src/navigation/DrawerContent.tsx](apps/mobile/src/navigation/DrawerContent.tsx)`

Change Forms nav item from `openInWeb: true` to in-app navigation:

```typescript
{
  label: "Forms",
  href: `/${slug}/forms`,
  icon: ClipboardList,
  // Remove openInWeb: true
}
```

## Key Implementation Details

### Real-time Sync

Subscribe to changes on all 4 tables filtered by `organization_id`:

```typescript
supabase.channel(`forms:${orgId}`)
  .on("postgres_changes", { event: "*", table: "forms", filter: `organization_id=eq.${orgId}` }, refetch)
  .on("postgres_changes", { event: "*", table: "form_documents", filter: `organization_id=eq.${orgId}` }, refetch)
  .on("postgres_changes", { event: "*", table: "form_submissions", filter: `organization_id=eq.${orgId}` }, refetch)
  .on("postgres_changes", { event: "*", table: "form_document_submissions", filter: `organization_id=eq.${orgId}` }, refetch)
  .subscribe()
```

### File Structure

```
apps/mobile/
├── src/hooks/
│   └── useForms.ts              # New hook
└── app/(app)/(drawer)/[orgSlug]/
    └── forms/
        ├── index.tsx            # Forms list screen
        ├── [formId].tsx         # Form fill screen
        └── documents/
            └── [documentId].tsx # Document submit screen
```

### Dependencies

- `expo-document-picker` - Already available in Expo SDK 54
- No new dependencies required

