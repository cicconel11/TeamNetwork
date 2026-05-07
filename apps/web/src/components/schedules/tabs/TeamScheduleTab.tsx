"use client";

import { useScheduleSources, useSchedulePreview } from "@/hooks";
import { ImportScheduleForm, SchedulePreviewCard, TeamGoogleCalendarConnect } from "../import";
import { ConnectedSourcesList } from "../sources";

type TeamScheduleTabProps = {
  orgId: string;
  orgSlug: string;
  isAdmin: boolean;
  isReadOnly?: boolean;
};

export function TeamScheduleTab({ orgId, orgSlug, isAdmin, isReadOnly }: TeamScheduleTabProps) {
  const {
    sources,
    loadingSources,
    syncingSourceId,
    pausingSourceId,
    removingSourceId,
    error: sourcesError,
    notice: sourcesNotice,
    refreshSources,
    handleSync,
    handleToggleStatus,
    handleRemove,
  } = useScheduleSources({ orgId, isAdmin });

  const {
    url,
    preview,
    verification,
    title,
    previewLoading,
    connectLoading,
    error: previewError,
    notice: previewNotice,
    previewDisabled,
    previewEvents,
    handleUrlChange,
    handleTitleChange,
    handlePreview,
    handleConnect,
  } = useSchedulePreview({ orgId, isAdmin, onConnect: refreshSources });

  const combinedError = previewError || sourcesError;
  const combinedNotice = previewNotice || sourcesNotice;

  return (
    <div className="space-y-6">
      <ImportScheduleForm
        url={url}
        onUrlChange={handleUrlChange}
        onPreview={handlePreview}
        previewLoading={previewLoading}
        previewDisabled={previewDisabled}
        isAdmin={isAdmin}
        verification={verification}
        error={combinedError}
        notice={combinedNotice}
      />

      <TeamGoogleCalendarConnect
        orgId={orgId}
        orgSlug={orgSlug}
        isAdmin={isAdmin}
        isReadOnly={isReadOnly}
        onSourceAdded={refreshSources}
      />

      {preview && (
        <SchedulePreviewCard
          preview={preview}
          previewEvents={previewEvents}
          title={title}
          onTitleChange={handleTitleChange}
          onConnect={handleConnect}
          connectLoading={connectLoading}
          isAdmin={isAdmin}
        />
      )}

      <ConnectedSourcesList
        sources={sources}
        loadingSources={loadingSources}
        isAdmin={isAdmin}
        syncingSourceId={syncingSourceId}
        pausingSourceId={pausingSourceId}
        removingSourceId={removingSourceId}
        onSync={handleSync}
        onToggleStatus={handleToggleStatus}
        onRemove={handleRemove}
      />
    </div>
  );
}
