"use client";

import type { RefObject } from "react";
import type { FileDropState } from "@/hooks/useFileDrop";

interface ImportDropZoneProps {
  fileDrop: FileDropState;
  hint: string;
  accept?: string;
}

export function ImportDropZone({ fileDrop, hint, accept = ".csv,.tsv,.txt" }: ImportDropZoneProps) {
  const { isDragging, fileInputRef, handleDragEnter, handleDragLeave, handleDragOver, handleDrop, handleFileClick, handleFileChange } = fileDrop;

  return (
    <div
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      onClick={() => fileInputRef.current?.click()}
      className={`relative flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed px-6 py-8 cursor-pointer transition-colors duration-150 ${
        isDragging
          ? "border-org-secondary bg-org-secondary/5"
          : "border-border/60 hover:border-muted-foreground/40 hover:bg-muted/30"
      }`}
    >
      <input
        ref={fileInputRef as RefObject<HTMLInputElement>}
        type="file"
        accept={accept}
        onClick={(e) => { e.stopPropagation(); handleFileClick(); }}
        onChange={handleFileChange}
        className="sr-only"
        tabIndex={-1}
      />
      <svg className={`h-8 w-8 transition-colors duration-150 ${isDragging ? "text-org-secondary" : "text-muted-foreground/40"}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m6.75 12-3-3m0 0-3 3m3-3v6m-1.5-15H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
      </svg>
      <div className="text-center">
        <p className="text-sm text-foreground">
          <span className="font-medium text-org-secondary">Choose a file</span>
          {" "}or drag & drop
        </p>
        <p className="text-xs text-muted-foreground mt-0.5">{hint}</p>
      </div>
    </div>
  );
}
