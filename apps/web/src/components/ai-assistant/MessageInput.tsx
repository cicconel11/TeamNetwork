"use client";

import { useRef, useCallback, useEffect } from "react";
import { Send, Square, AlertCircle, X, Paperclip, FileText, Loader2 } from "lucide-react";
import type { AIChatAttachment } from "@/hooks/useAIStream";

interface MessageInputProps {
  input: string;
  isStreaming: boolean;
  isUploadingAttachment?: boolean;
  error: string | null;
  attachmentError?: string | null;
  attachment?: AIChatAttachment | null;
  toolStatusLabel?: string | null;
  placeholder?: string;
  onInputChange: (value: string) => void;
  onSend: (message: string) => Promise<void>;
  onAttachFile: (file: File) => Promise<void>;
  onRemoveAttachment: () => void;
  onCancel: () => void;
  onClearError: () => void;
}

export function MessageInput({
  input,
  isStreaming,
  isUploadingAttachment = false,
  error,
  attachmentError,
  attachment,
  toolStatusLabel,
  placeholder,
  onInputChange,
  onSend,
  onAttachFile,
  onRemoveAttachment,
  onCancel,
  onClearError,
}: MessageInputProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const resizeTextarea = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, []);

  useEffect(() => {
    resizeTextarea();
  }, [input, resizeTextarea]);

  const handleSend = useCallback(async () => {
    const trimmed = input.trim();
    if (!trimmed || isStreaming || isUploadingAttachment) return;
    await onSend(trimmed);
  }, [input, isStreaming, isUploadingAttachment, onSend]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }, [handleSend]);

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    void onAttachFile(file);
  }, [onAttachFile]);

  const canSend = Boolean(input.trim()) && !isUploadingAttachment;
  const attachmentControlsDisabled = isStreaming || isUploadingAttachment;

  return (
    <div className="p-3">
      {/* Error banner */}
      {error && (
        <div className="mb-3 flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-400">
          <AlertCircle className="h-3.5 w-3.5 shrink-0" />
          <span className="flex-1">{error}</span>
          <button
            onClick={onClearError}
            aria-label="Dismiss error"
            className="rounded-md p-0.5 text-red-400 transition-colors hover:bg-red-100 hover:text-red-600 dark:hover:bg-red-900/50"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* Streaming status */}
      {isStreaming && (
        <div className="mb-3 flex items-center justify-between rounded-xl bg-org-secondary/5 px-3 py-2">
          <span className="flex items-center gap-2 text-xs text-org-secondary">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-org-secondary opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-org-secondary" />
            </span>
            {toolStatusLabel ?? "Thinking..."}
          </span>
          <button
            onClick={onCancel}
            className="flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium text-red-500 transition-colors hover:bg-red-500/10"
          >
            <Square className="h-3 w-3" />
            Stop
          </button>
        </div>
      )}

      {/* Floating dock input */}
      <div className="overflow-hidden rounded-2xl border border-border/60 bg-card shadow-lg shadow-black/5 transition-shadow focus-within:border-org-secondary/50 focus-within:shadow-org-secondary/10 dark:shadow-black/20">
        {/* Attachment preview */}
        {(attachment || isUploadingAttachment || attachmentError) && (
          <div className="border-b border-border/50 px-3 py-2">
            {(attachment || isUploadingAttachment) && (
              <div className="flex items-center gap-2 rounded-lg bg-muted/50 px-2.5 py-1.5 text-xs">
                {isUploadingAttachment ? (
                  <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-org-secondary" />
                ) : (
                  <FileText className="h-3.5 w-3.5 shrink-0 text-org-secondary" />
                )}
                <span className="min-w-0 flex-1 truncate text-foreground">
                  {isUploadingAttachment ? "Uploading schedule file..." : attachment?.fileName}
                </span>
                {attachment && (
                  <button
                    onClick={onRemoveAttachment}
                    disabled={attachmentControlsDisabled}
                    aria-label="Remove attached schedule file"
                    className="shrink-0 rounded p-0.5 text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            )}
            {attachmentError && (
              <p className="mt-1.5 text-xs text-red-500">{attachmentError}</p>
            )}
          </div>
        )}

        {/* Input area */}
        <div className="flex items-end gap-1.5 p-2">
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg,image/jpg"
            className="hidden"
            onChange={handleFileChange}
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={attachmentControlsDisabled}
            aria-label={attachment ? "Replace attached schedule file" : "Attach schedule file"}
            className="shrink-0 rounded-xl p-2 text-muted-foreground transition-colors hover:bg-muted/70 hover:text-foreground disabled:opacity-40"
          >
            <Paperclip className="h-4 w-4" />
          </button>
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => onInputChange(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={placeholder ?? "Ask about your organization..."}
            disabled={isStreaming || isUploadingAttachment}
            rows={1}
            className="max-h-28 min-h-[36px] flex-1 resize-none bg-transparent py-2 text-sm leading-relaxed text-foreground placeholder:text-muted-foreground focus:outline-none disabled:opacity-50"
          />
          <button
            onClick={isStreaming ? onCancel : handleSend}
            disabled={!isStreaming && !canSend}
            aria-label={isStreaming ? "Stop" : "Send"}
            className="shrink-0 rounded-xl bg-org-secondary p-2 text-org-secondary-foreground shadow-sm transition-all hover:bg-org-secondary-dark hover:shadow-md focus:outline-none focus:ring-2 focus:ring-org-secondary focus:ring-offset-1 focus:ring-offset-card disabled:opacity-40 disabled:shadow-none"
          >
            {isStreaming ? <Square className="h-4 w-4" /> : <Send className="h-4 w-4" />}
          </button>
        </div>
      </div>
    </div>
  );
}
