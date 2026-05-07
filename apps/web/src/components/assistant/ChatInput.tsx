"use client";

import { useRef, useCallback, useEffect } from "react";
import { Send, Square, Paperclip, FileText, Loader2, X, AlertCircle } from "lucide-react";
import type { AIChatAttachment } from "@/hooks/useAIStream";

interface ChatInputProps {
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

export function ChatInput({
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
}: ChatInputProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const resizeTextarea = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    const newHeight = Math.min(el.scrollHeight, 200);
    el.style.height = `${newHeight}px`;
  }, []);

  useEffect(() => {
    resizeTextarea();
  }, [input, resizeTextarea]);

  const handleSend = useCallback(async () => {
    const trimmed = input.trim();
    if (!trimmed || isStreaming || isUploadingAttachment) return;
    await onSend(trimmed);
  }, [input, isStreaming, isUploadingAttachment, onSend]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend]
  );

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      e.target.value = "";
      if (!file) return;
      void onAttachFile(file);
    },
    [onAttachFile]
  );

  const canSend = Boolean(input.trim()) && !isUploadingAttachment;
  const attachmentControlsDisabled = isStreaming || isUploadingAttachment;

  return (
    <div className="mx-auto w-full max-w-3xl px-4 pb-6">
      {/* Error banner */}
      {error && (
        <div className="mb-3 flex items-center gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 dark:border-red-900/50 dark:bg-red-950/30">
          <AlertCircle className="h-4 w-4 shrink-0 text-red-500" />
          <span className="flex-1 text-sm text-red-700 dark:text-red-400">{error}</span>
          <button
            onClick={onClearError}
            aria-label="Dismiss error"
            className="rounded-lg p-1 text-red-400 transition-colors hover:bg-red-100 hover:text-red-600 dark:hover:bg-red-900/50"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Streaming status */}
      {isStreaming && (
        <div className="mb-3 flex items-center justify-between rounded-xl bg-org-secondary/5 px-4 py-2">
          <span className="flex items-center gap-2 text-sm text-org-secondary">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-org-secondary opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-org-secondary" />
            </span>
            {toolStatusLabel ?? "Thinking..."}
          </span>
          <button
            onClick={onCancel}
            className="flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-sm font-medium text-red-500 transition-colors hover:bg-red-500/10"
          >
            <Square className="h-3 w-3" />
            Stop
          </button>
        </div>
      )}

      {/* Main input dock */}
      <div className="overflow-hidden rounded-2xl border border-border/80 bg-card shadow-lg shadow-black/5 transition-shadow focus-within:border-org-secondary/50 focus-within:shadow-org-secondary/10 dark:shadow-black/20">
        {/* Attachment preview */}
        {(attachment || isUploadingAttachment || attachmentError) && (
          <div className="border-b border-border/50 px-4 py-3">
            {(attachment || isUploadingAttachment) && (
              <div className="flex items-center gap-3 rounded-lg bg-muted/50 px-3 py-2">
                {isUploadingAttachment ? (
                  <Loader2 className="h-4 w-4 shrink-0 animate-spin text-org-secondary" />
                ) : (
                  <FileText className="h-4 w-4 shrink-0 text-org-secondary" />
                )}
                <span className="min-w-0 flex-1 truncate text-sm text-foreground">
                  {isUploadingAttachment ? "Uploading..." : attachment?.fileName}
                </span>
                {attachment && (
                  <button
                    onClick={onRemoveAttachment}
                    disabled={attachmentControlsDisabled}
                    aria-label="Remove attachment"
                    className="shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-40"
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
              </div>
            )}
            {attachmentError && (
              <p className="mt-2 text-sm text-red-500">{attachmentError}</p>
            )}
          </div>
        )}

        {/* Input area */}
        <div className="flex items-end gap-2 p-3">
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
            aria-label={attachment ? "Replace attachment" : "Attach file"}
            className="shrink-0 rounded-xl p-2.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-40"
          >
            <Paperclip className="h-5 w-5" />
          </button>

          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => onInputChange(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={placeholder ?? "Ask anything about your organization..."}
            disabled={isStreaming || isUploadingAttachment}
            rows={1}
            className="max-h-[200px] min-h-[44px] flex-1 resize-none bg-transparent py-2.5 text-sm leading-relaxed text-foreground placeholder:text-muted-foreground focus:outline-none disabled:opacity-50"
          />

          <button
            onClick={isStreaming ? onCancel : handleSend}
            disabled={!isStreaming && !canSend}
            aria-label={isStreaming ? "Stop generation" : "Send message"}
            className="shrink-0 rounded-xl bg-org-secondary p-2.5 text-org-secondary-foreground shadow-sm transition-all hover:bg-org-secondary-dark hover:shadow-md focus:outline-none focus:ring-2 focus:ring-org-secondary focus:ring-offset-2 focus:ring-offset-card disabled:opacity-40 disabled:shadow-none"
          >
            {isStreaming ? (
              <Square className="h-5 w-5" />
            ) : (
              <Send className="h-5 w-5" />
            )}
          </button>
        </div>
      </div>

      {/* Helper text */}
      <p className="mt-2 text-center text-xs text-muted-foreground/70">
        Press Enter to send, Shift+Enter for new line
      </p>
    </div>
  );
}
