"use client";

import { useEffect, useState, useCallback } from "react";
import { generateQRSvg } from "@/lib/qr-utils";
import { Button } from "@/components/ui";
import { debugLog } from "@/lib/debug";

interface QRCodeDisplayProps {
  url: string;
  size?: number;
}

export function QRCodeDisplay({ url, size = 200 }: QRCodeDisplayProps) {
  const [svgString, setSvgString] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;

    if (!url?.trim()) {
      setSvgString(null);
      setError("No URL provided");
      return;
    }

    debugLog("qr-code", "generating", {
      urlLength: url.length,
      urlPreview: url.slice(0, 50),
      size,
    });

    generateQRSvg(url, size).then((result) => {
      if (cancelled) return;
      if (result.error) {
        debugLog("qr-code", "generation error", result.error);
        setSvgString(null);
        setError(result.error);
      } else {
        debugLog("qr-code", "generated ok", {
          svgLength: result.svg?.length ?? 0,
        });
        setSvgString(result.svg);
        setError(null);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [url, size]);

  const handleCopyLink = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      const textarea = document.createElement("textarea");
      textarea.value = url;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }, [url]);

  if (error) {
    return (
      <div className="flex flex-col items-center gap-3 p-4">
        <p className="text-sm text-muted-foreground">{error}</p>
        {url?.trim() && (
          <>
            <div className="flex gap-2">
              <Button variant="secondary" size="sm" onClick={handleCopyLink}>
                {copied ? "Copied!" : "Copy link"}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => window.open(url, "_blank", "noopener,noreferrer")}
              >
                Open link
              </Button>
            </div>
            <p className="text-xs text-muted-foreground text-center max-w-[250px] truncate">
              {url}
            </p>
          </>
        )}
      </div>
    );
  }

  if (!svgString) {
    return (
      <div className="flex items-center justify-center p-4">
        <div className="animate-pulse bg-muted" style={{ width: size, height: size }} />
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-3">
      <div
        className="bg-white"
        style={{ width: size, height: size }}
        dangerouslySetInnerHTML={{ __html: svgString }}
      />
      <p className="text-xs text-muted-foreground text-center max-w-[200px] truncate">
        {url}
      </p>
    </div>
  );
}
