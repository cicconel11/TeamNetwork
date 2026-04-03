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
    <div className="border-t border-border p-3">
      {error && (
        <div className="mb-2 flex items-center gap-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700 dark:bg-red-900/20 dark:text-red-400">
          <AlertCircle className="h-3.5 w-3.5 shrink-0" />
          <span className="flex-1">{error}</span>
          <button
            onClick={onClearError}
            aria-label="Dismiss error"
            className="rounded p-0.5 text-red-400 hover:text-red-600"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
      {(attachment || isUploadingAttachment || attachmentError) && (
        <div className="mb-2 space-y-2">
          {(attachment || isUploadingAttachment) && (
            <div className="flex items-center justify-between gap-2 rounded-lg border border-border bg-muted/50 px-3 py-2 text-xs text-foreground">
              <span className="flex min-w-0 items-center gap-2">
                {isUploadingAttachment ? (
                  <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-indigo-500" />
                ) : (
                  <FileText className="h-3.5 w-3.5 shrink-0 text-indigo-500" />
                )}
                <span className="truncate">
                  {isUploadingAttachment ? "Uploading schedule file..." : attachment?.fileName}
                </span>
              </span>
              {attachment && (
                <button
                  onClick={onRemoveAttachment}
                  disabled={attachmentControlsDisabled}
                  aria-label="Remove attached schedule file"
                  className="rounded p-0.5 text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          )}
          {attachmentError && (
            <p className="text-xs text-red-600 dark:text-red-400">{attachmentError}</p>
          )}
        </div>
      )}
      {isStreaming && (
        <div className="mb-2 flex items-center justify-between text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 animate-pulse rounded-full bg-indigo-500" />
            {toolStatusLabel ?? "Thinking..."}
          </span>
          <button
            onClick={onCancel}
            className="flex items-center gap-1 rounded px-1.5 py-0.5 text-red-500 transition-colors hover:bg-red-50 hover:text-red-700 dark:hover:bg-red-900/20"
          >
            <Square className="h-3 w-3" />
            Stop
          </button>
        </div>
      )}
      <div className="flex items-end gap-2">
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
          className="rounded-xl border border-border bg-background p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-40"
        >
          <Paperclip className="h-4 w-4" />
        </button>
        <textarea
          ref={textareaRef}
          value={input}
          onChange={(e) => {
            onInputChange(e.target.value);
          }}
          onKeyDown={handleKeyDown}
          placeholder={placeholder ?? "Ask about your organization..."}
          disabled={isStreaming || isUploadingAttachment}
          rows={1}
          className="max-h-32 flex-1 resize-none rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 disabled:opacity-50"
        />
        <button
          onClick={isStreaming ? onCancel : handleSend}
          disabled={!isStreaming && !canSend}
          aria-label={isStreaming ? "Stop generation" : "Send message"}
          className="rounded-xl bg-indigo-600 p-2 text-white transition-colors hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 focus:ring-offset-background disabled:opacity-40"
        >
          {isStreaming ? <Square className="h-4 w-4" /> : <Send className="h-4 w-4" />}
        </button>
      </div>
    </div>
  );
}
