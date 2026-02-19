"use client";

import { useCallback, useRef, useState } from "react";

interface DropZoneProps {
  onFiles: (files: File[]) => { rejected: { name: string; error: string }[] };
  disabled?: boolean;
}

export function DropZone({ onFiles, disabled = false }: DropZoneProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragActive, setDragActive] = useState(false);
  const [rejections, setRejections] = useState<{ name: string; error: string }[]>([]);

  const handleFiles = useCallback(
    (files: FileList | File[]) => {
      const arr = Array.from(files);
      if (arr.length === 0) return;
      const result = onFiles(arr);
      if (result.rejected.length > 0) {
        setRejections(result.rejected);
        // Auto-clear after 5s
        setTimeout(() => setRejections([]), 5000);
      }
    },
    [onFiles],
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setDragActive(false);
      if (disabled) return;
      handleFiles(e.dataTransfer.files);
    },
    [disabled, handleFiles],
  );

  const handleDragOver = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (!disabled) setDragActive(true);
    },
    [disabled],
  );

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if ((e.key === "Enter" || e.key === " ") && !disabled) {
        e.preventDefault();
        fileInputRef.current?.click();
      }
    },
    [disabled],
  );

  return (
    <div className="space-y-2">
      <div
        role="button"
        tabIndex={0}
        className={`relative border-2 border-dashed rounded-xl p-6 text-center transition-all duration-200 cursor-pointer ${
          disabled
            ? "opacity-50 cursor-not-allowed border-[var(--border)]"
            : dragActive
              ? "border-[var(--color-org-secondary)] bg-[var(--color-org-secondary)]/5 scale-[1.01]"
              : "border-[var(--border)] hover:border-[var(--muted-foreground)]"
        }`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={() => !disabled && fileInputRef.current?.click()}
        onKeyDown={handleKeyDown}
      >
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept="image/*,video/*"
          className="hidden"
          onChange={(e) => {
            if (e.target.files) handleFiles(e.target.files);
            e.target.value = "";
          }}
        />
        <svg
          className="w-8 h-8 mx-auto text-[var(--muted-foreground)] mb-2 opacity-40"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={1.5}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5"
          />
        </svg>
        <p className="text-sm text-[var(--foreground)] font-medium mb-0.5">
          Drop files or <span className="text-[var(--color-org-secondary)]">browse</span>
        </p>
        <p className="text-xs text-[var(--muted-foreground)]">
          Images up to 10 MB, videos up to 100 MB. Max 20 files.
        </p>
      </div>

      {rejections.length > 0 && (
        <div className="space-y-1 animate-fade-in">
          {rejections.map((r, i) => (
            <div
              key={`${r.name}-${i}`}
              className="flex items-start gap-2 text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/20 rounded-lg px-3 py-2"
            >
              <svg className="w-3.5 h-3.5 mt-0.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
              </svg>
              <span>
                <span className="font-medium">{r.name}</span> — {r.error}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
