"use client";

import { useState } from "react";
import { Button } from "@/components/ui";

interface ExportCsvButtonProps {
  endpoint: string;
  fileName: string;
  label?: string;
}

export function ExportCsvButton({ endpoint, fileName, label = "Export CSV" }: ExportCsvButtonProps) {
  const [isLoading, setIsLoading] = useState(false);

  const handleExport = async () => {
    setIsLoading(true);

    try {
      const response = await fetch(endpoint, { method: "GET" });

      if (!response.ok) {
        const data = await response.json().catch(() => null);
        throw new Error(data?.message || "Unable to export CSV.");
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to export CSV.";
      alert(message);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Button variant="secondary" size="sm" onClick={handleExport} isLoading={isLoading}>
      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
      </svg>
      {label}
    </Button>
  );
}
