"use client";

import { Button, Card } from "@/components/ui";
import { DomainVerificationAlert } from "./DomainVerificationAlert";
import type { VerificationResponse } from "@/hooks";

type ImportScheduleFormProps = {
  url: string;
  onUrlChange: (url: string) => void;
  onPreview: () => void;
  previewLoading: boolean;
  previewDisabled: boolean;
  isAdmin: boolean;
  verification: VerificationResponse | null;
  error: string | null;
  notice: string | null;
};

function LinkIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="currentColor">
      <path d="M12.232 4.232a2.5 2.5 0 013.536 3.536l-1.225 1.224a.75.75 0 001.061 1.06l1.224-1.224a4 4 0 00-5.656-5.656l-3 3a4 4 0 00.225 5.865.75.75 0 00.977-1.138 2.5 2.5 0 01-.142-3.667l3-3z" />
      <path d="M11.603 7.963a.75.75 0 00-.977 1.138 2.5 2.5 0 01.142 3.667l-3 3a2.5 2.5 0 01-3.536-3.536l1.225-1.224a.75.75 0 00-1.061-1.06l-1.224 1.224a4 4 0 105.656 5.656l3-3a4 4 0 00-.225-5.865z" />
    </svg>
  );
}

function DownloadIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="currentColor">
      <path d="M10.75 2.75a.75.75 0 00-1.5 0v8.614L6.295 8.235a.75.75 0 10-1.09 1.03l4.25 4.5a.75.75 0 001.09 0l4.25-4.5a.75.75 0 00-1.09-1.03l-2.955 3.129V2.75z" />
      <path d="M3.5 12.75a.75.75 0 00-1.5 0v2.5A2.75 2.75 0 004.75 18h10.5A2.75 2.75 0 0018 15.25v-2.5a.75.75 0 00-1.5 0v2.5c0 .69-.56 1.25-1.25 1.25H4.75c-.69 0-1.25-.56-1.25-1.25v-2.5z" />
    </svg>
  );
}

function LightbulbIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="currentColor">
      <path d="M10 1a6 6 0 00-3.815 10.631C7.237 12.5 8 13.443 8 14.456v.644a.75.75 0 00.75.75h2.5a.75.75 0 00.75-.75v-.644c0-1.013.762-1.957 1.815-2.825A6 6 0 0010 1zM8.863 17.414a.75.75 0 00-.226 1.483 9.066 9.066 0 002.726 0 .75.75 0 00-.226-1.483 7.553 7.553 0 01-2.274 0z" />
    </svg>
  );
}

export function ImportScheduleForm({
  url,
  onUrlChange,
  onPreview,
  previewLoading,
  previewDisabled,
  isAdmin,
  verification,
  error,
  notice,
}: ImportScheduleFormProps) {
  return (
    <section>
      <Card className="bg-gradient-to-br from-card to-muted/30 p-5 space-y-4">
        {/* Section header with icon */}
        <div className="flex items-center gap-2">
          <div className="p-2 bg-org-secondary/10 rounded-lg">
            <DownloadIcon className="w-5 h-5 text-org-secondary" />
          </div>
          <h2 className="text-lg font-display font-semibold text-foreground">Import Team Schedule</h2>
        </div>

        {/* Input with icon and enhanced focus glow */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
          <div className="flex-1 space-y-2">
            <label htmlFor="schedule-url" className="sr-only">Schedule URL</label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none">
                <LinkIcon className="w-5 h-5 text-muted-foreground" />
              </div>
              <input
                id="schedule-url"
                type="url"
                value={url}
                onChange={(event) => onUrlChange(event.target.value)}
                placeholder="https://athletics.example.com/schedule"
                className="
                  w-full pl-11 pr-4 py-3 rounded-xl border border-border bg-card
                  text-foreground placeholder:text-muted-foreground
                  focus:outline-none focus:ring-2 focus:ring-org-secondary/50 focus:border-org-secondary
                  focus:shadow-[0_0_0_4px_rgba(var(--color-org-secondary-rgb,16,185,129),0.1)]
                  transition-all duration-200
                "
              />
            </div>
            {/* Helper text with icon */}
            <div className="flex items-start gap-1.5 text-xs text-muted-foreground">
              <LightbulbIcon className="w-4 h-4 flex-shrink-0 text-warning/70" />
              <span>Paste a public schedule link or iCal/ICS export (look for &quot;Subscribe&quot; or &quot;iCal&quot; on the athletics site).</span>
            </div>
          </div>
          <Button
            onClick={onPreview}
            isLoading={previewLoading}
            disabled={previewDisabled || !isAdmin}
            className="sm:mt-0"
          >
            Preview
          </Button>
        </div>

        {verification && verification.allowStatus !== "active" && (
          <DomainVerificationAlert verification={verification} isAdmin={isAdmin} />
        )}
        {notice && <p className="text-sm text-foreground">{notice}</p>}
        {error && <p className="text-sm text-error">{error}</p>}
        {!isAdmin && (
          <p className="text-xs text-muted-foreground bg-muted/50 rounded-lg px-3 py-2">
            Only admins can preview and connect schedule sources.
          </p>
        )}
      </Card>
    </section>
  );
}
