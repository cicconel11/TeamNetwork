"use client";

import { useCallback, useRef, useState } from "react";

interface DropZoneProps {
  onFiles: (files: File[]) => { rejected: { name: string; error: string }[] };
  onFolder?: (files: File[], folderName: string) => void;
  disabled?: boolean;
}

type DragMode = "idle" | "files" | "folder";

/** Recursively read all files from a directory entry. */
async function readDirectoryFiles(dirEntry: FileSystemDirectoryEntry): Promise<File[]> {
  return new Promise((resolve) => {
    const files: File[] = [];
    const reader = dirEntry.createReader();

    const readEntries = () => {
      reader.readEntries(async (entries) => {
        if (entries.length === 0) {
          resolve(files);
          return;
        }

        for (const entry of entries) {
          if (entry.isFile) {
            const fileEntry = entry as FileSystemFileEntry;
            await new Promise<void>((res) => {
              fileEntry.file((f) => {
                files.push(f);
                res();
              });
            });
          } else if (entry.isDirectory) {
            const subFiles = await readDirectoryFiles(entry as FileSystemDirectoryEntry);
            files.push(...subFiles);
          }
        }

        // readEntries returns max 100 at a time — call again for more
        readEntries();
      });
    };

    readEntries();
  });
}

export function DropZone({ onFiles, onFolder, disabled = false }: DropZoneProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const [dragMode, setDragMode] = useState<DragMode>("idle");
  const [rejections, setRejections] = useState<{ name: string; error: string }[]>([]);

  const handleFiles = useCallback(
    (files: FileList | File[]) => {
      const arr = Array.from(files);
      if (arr.length === 0) return;
      const result = onFiles(arr);
      if (result.rejected.length > 0) {
        setRejections(result.rejected);
        setTimeout(() => setRejections([]), 5000);
      }
    },
    [onFiles],
  );

  const handleDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setDragMode("idle");
      if (disabled) return;

      const items = e.dataTransfer.items;

      // Check if the drop contains a directory
      if (items && onFolder) {
        for (let i = 0; i < items.length; i++) {
          const item = items[i];
          const entry = item.webkitGetAsEntry?.();
          if (entry?.isDirectory) {
            const dirEntry = entry as FileSystemDirectoryEntry;
            const files = await readDirectoryFiles(dirEntry);
            const mediaFiles = files.filter(
              (f) => f.type.startsWith("image/") || f.type.startsWith("video/"),
            );
            if (mediaFiles.length > 0) {
              onFolder(mediaFiles, dirEntry.name);
            }
            return;
          }
        }
      }

      handleFiles(e.dataTransfer.files);
    },
    [disabled, handleFiles, onFolder],
  );

  const handleDragOver = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (disabled) return;

      const items = e.dataTransfer.items;
      // Heuristic: single item with no MIME type = likely a folder
      const isLikelyFolder =
        items.length === 1 && items[0].kind === "file" && items[0].type === "";
      setDragMode(isLikelyFolder ? "folder" : "files");
    },
    [disabled],
  );

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragMode("idle");
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

  const handleFolderInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (!e.target.files || !onFolder) return;
      const files = Array.from(e.target.files);
      if (files.length === 0) return;

      // Derive folder name from webkitRelativePath (e.g. "FolderName/file.jpg")
      const firstPath = files[0].webkitRelativePath || "";
      const folderName = firstPath.split("/")[0] || "Uploaded Folder";

      const mediaFiles = files.filter(
        (f) => f.type.startsWith("image/") || f.type.startsWith("video/"),
      );
      if (mediaFiles.length > 0 && onFolder) {
        onFolder(mediaFiles, folderName);
      }

      e.target.value = "";
    },
    [onFolder],
  );

  // Determine the active drag state for the main drop zone
  const isFolderDrag = dragMode === "folder";
  const isFilesDrag = dragMode === "files";

  return (
    <div className="space-y-2">
      {/* Hidden file input */}
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
      {/* Hidden folder input */}
      {onFolder && (
        <input
          ref={folderInputRef}
          type="file"
          multiple
          accept="image/*,video/*"
          className="hidden"
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          {...({ webkitdirectory: "" } as any)}
          onChange={handleFolderInputChange}
        />
      )}

      {/* Main drop zone */}
      <div
        role="button"
        tabIndex={0}
        className={`relative border-2 border-dashed rounded-xl p-6 text-center transition-all duration-200 cursor-pointer ${
          disabled
            ? "opacity-50 cursor-not-allowed border-[var(--border)]"
            : isFolderDrag
              ? "border-amber-400 bg-amber-50 dark:bg-amber-950/20 scale-[1.01]"
              : isFilesDrag
                ? "border-[var(--color-org-secondary)] bg-[var(--color-org-secondary)]/5 scale-[1.01]"
                : "border-[var(--border)] hover:border-[var(--muted-foreground)]"
        }`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={() => !disabled && fileInputRef.current?.click()}
        onKeyDown={handleKeyDown}
      >
        {isFolderDrag ? (
          <>
            {/* Folder drag state */}
            <svg
              className="w-8 h-8 mx-auto mb-2 text-amber-500"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={1.5}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M3.75 9.776c.112-.017.227-.026.344-.026h15.812c.117 0 .232.009.344.026m-16.5 0a2.25 2.25 0 00-1.883 2.542l.857 6a2.25 2.25 0 002.227 1.932H19.05a2.25 2.25 0 002.227-1.932l.857-6a2.25 2.25 0 00-1.883-2.542m-16.5 0V6A2.25 2.25 0 016 3.75h3.879a1.5 1.5 0 011.06.44l2.122 2.12a1.5 1.5 0 001.06.44H18A2.25 2.25 0 0120.25 9v.776"
              />
            </svg>
            <p className="text-sm font-semibold text-amber-700 dark:text-amber-400">
              Drop to create album
            </p>
            <p className="text-xs text-amber-600/70 dark:text-amber-500/70 mt-0.5">
              Folder contents will be uploaded as a new album
            </p>
          </>
        ) : (
          <>
            <svg
              className={`w-8 h-8 mx-auto mb-2 transition-colors ${
                isFilesDrag
                  ? "text-[var(--color-org-secondary)]"
                  : "text-[var(--muted-foreground)] opacity-40"
              }`}
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
              {isFilesDrag ? (
                "Drop photos & videos"
              ) : (
                <>
                  Drop files or{" "}
                  <span className="text-[var(--color-org-secondary)]">browse</span>
                </>
              )}
            </p>
            <p className="text-xs text-[var(--muted-foreground)]">
              Images up to 10 MB, videos up to 100 MB. Max 20 files.
            </p>
          </>
        )}
      </div>

      {/* Folder upload button — secondary zone */}
      {onFolder && (
        <button
          type="button"
          onClick={() => !disabled && folderInputRef.current?.click()}
          disabled={disabled}
          className={`w-full flex items-center justify-center gap-2 rounded-xl border border-dashed py-2.5 px-4 text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
            isFolderDrag
              ? "border-amber-400 text-amber-600 bg-amber-50 dark:bg-amber-950/20"
              : "border-[var(--border)] text-[var(--muted-foreground)] hover:border-[var(--color-org-secondary)] hover:text-[var(--color-org-secondary)]"
          }`}
        >
          <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M3 7a2 2 0 012-2h4l2 2h6a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z"
            />
          </svg>
          Upload folder as album
        </button>
      )}

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
