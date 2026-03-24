"use client";

import { Button } from "@/components/ui";
import { getResultClasses, type ImportResultBase } from "@/lib/alumni/import-utils";

interface ImportResultBannerProps {
  result: ImportResultBase;
  onReset: () => void;
  onClose?: () => void;
  extraDetail?: React.ReactNode;
}

export function ImportResultBanner({ result, onReset, onClose, extraDetail }: ImportResultBannerProps) {
  const resultClasses = getResultClasses(result);

  return (
    <div className={`rounded-lg border p-4 ${resultClasses.border}`} aria-live="polite">
      <p className={`font-medium text-sm ${resultClasses.text}`}>
        {result.updated > 0 || result.created > 0
          ? [
              result.created > 0 ? `${result.created} created` : null,
              result.updated > 0 ? `${result.updated} updated` : null,
            ].filter(Boolean).join(", ")
          : result.quotaBlocked > 0
            ? `${result.quotaBlocked} quota blocked`
            : "No records changed"}
      </p>
      <p className="text-xs text-muted-foreground mt-1">
        {result.created} created, {result.updated} updated, {result.skipped} skipped, {result.quotaBlocked} quota blocked
      </p>
      {extraDetail}
      {Array.isArray(result.errors) && result.errors.length > 0 && (
        <div className="text-xs text-red-400 mt-1">
          {result.errors.map((err, i) => (
            <p key={i}>{err}</p>
          ))}
        </div>
      )}
      <div className="flex gap-2 mt-3">
        <Button size="sm" variant="ghost" onClick={onReset}>
          Import Another
        </Button>
        {onClose && (
          <Button size="sm" variant="ghost" onClick={onClose}>
            Done
          </Button>
        )}
      </div>
    </div>
  );
}
