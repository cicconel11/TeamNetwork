"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui";
import { generateQRSvg } from "@/lib/qr-utils";
import { buildEventSelfCheckInDeepLink } from "@/lib/events/event-self-check-in-link";

interface EventSelfCheckInQrButtonProps {
  eventId: string;
  orgSlug: string;
}

export function EventSelfCheckInQrButton({ eventId, orgSlug }: EventSelfCheckInQrButtonProps) {
  const [open, setOpen] = useState(false);
  const [svg, setSvg] = useState<string | null>(null);
  const [qrError, setQrError] = useState<string | null>(null);

  const uri = buildEventSelfCheckInDeepLink(eventId, orgSlug);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setQrError(null);
    setSvg(null);

    generateQRSvg(uri, 280).then((res) => {
      if (cancelled) return;
      if (res.error) {
        setQrError(res.error);
        return;
      }
      setSvg(res.svg);
    });

    return () => {
      cancelled = true;
    };
  }, [open, uri]);

  return (
    <>
      <Button type="button" variant="secondary" onClick={() => setOpen(true)} data-testid="event-show-qr-button">
        Show event QR
      </Button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          role="presentation"
          onClick={() => setOpen(false)}
        >
          <div
            className="relative w-full max-w-md rounded-xl border border-border bg-card p-6 shadow-lg"
            role="dialog"
            aria-modal="true"
            aria-labelledby="event-self-check-in-qr-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 id="event-self-check-in-qr-title" className="text-lg font-semibold text-foreground">
              Event check-in QR
            </h3>
            <p className="mt-2 text-sm text-muted-foreground">
              Members scan this in the TeamMeet app to check in. Geofencing applies when enabled on this event.
            </p>

            {qrError && (
              <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-900/30 dark:text-red-300">
                {qrError}
              </p>
            )}

            {svg ? (
              <div
                className="mt-4 flex justify-center [&>svg]:h-auto [&>svg]:max-w-[min(280px,100%)]"
                dangerouslySetInnerHTML={{ __html: svg }}
              />
            ) : !qrError ? (
              <p className="mt-6 text-center text-sm text-muted-foreground">Generating…</p>
            ) : null}

            <p className="mt-4 max-h-24 overflow-y-auto break-all font-mono text-xs text-muted-foreground">
              {uri}
            </p>

            <div className="mt-6 flex justify-end">
              <Button type="button" onClick={() => setOpen(false)}>
                Close
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
