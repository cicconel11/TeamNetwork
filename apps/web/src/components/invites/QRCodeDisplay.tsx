"use client";

import { useEffect, useState } from "react";

interface QRCodeDisplayProps {
  url: string;
  size?: number;
}

export function QRCodeDisplay({ url, size = 200 }: QRCodeDisplayProps) {
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const generateQR = async () => {
      try {
        // Use a simple QR code API since we don't want to add a dependency
        const qrApiUrl = `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&data=${encodeURIComponent(url)}`;
        setQrDataUrl(qrApiUrl);
      } catch (err) {
        setError("Failed to generate QR code");
        console.error(err);
      }
    };

    generateQR();
  }, [url, size]);

  if (error) {
    return (
      <div className="flex items-center justify-center p-4 text-sm text-muted-foreground">
        {error}
      </div>
    );
  }

  if (!qrDataUrl) {
    return (
      <div className="flex items-center justify-center p-4">
        <div className="animate-pulse bg-muted rounded-xl" style={{ width: size, height: size }} />
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-3">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={qrDataUrl}
        alt="QR Code"
        width={size}
        height={size}
        className="rounded-xl border border-border"
      />
      <p className="text-xs text-muted-foreground text-center max-w-[200px] truncate">
        {url}
      </p>
    </div>
  );
}

