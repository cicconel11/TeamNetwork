"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { Send, Square, AlertCircle, X } from "lucide-react";

interface MessageInputProps {
  isStreaming: boolean;
  error: string | null;
  onSend: (message: string) => Promise<void>;
  onCancel: () => void;
  onClearError: () => void;
}

export function MessageInput({
  isStreaming,
  error,
  onSend,
  onCancel,
  onClearError,
}: MessageInputProps) {
  const [input, setInput] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const resizeTextarea = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, []);

  // Reset height when input is programmatically cleared (e.g. after send)
  useEffect(() => {
    if (!input) resizeTextarea();
  }, [input, resizeTextarea]);

  const handleSend = useCallback(async () => {
    const trimmed = input.trim();
    if (!trimmed || isStreaming) return;

    setInput("");
    await onSend(trimmed);
  }, [input, isStreaming, onSend]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }, [handleSend]);

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
      {isStreaming && (
        <div className="mb-2 flex items-center justify-between text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 animate-pulse rounded-full bg-indigo-500" />
            Thinking...
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
        <textarea
          ref={textareaRef}
          value={input}
          onChange={(e) => {
            setInput(e.target.value);
            resizeTextarea();
          }}
          onKeyDown={handleKeyDown}
          placeholder="Ask about your organization..."
          disabled={isStreaming}
          rows={1}
          className="max-h-32 flex-1 resize-none rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 disabled:opacity-50"
        />
        <button
          onClick={isStreaming ? onCancel : handleSend}
          disabled={!isStreaming && !input.trim()}
          aria-label={isStreaming ? "Stop generation" : "Send message"}
          className="rounded-xl bg-indigo-600 p-2 text-white transition-colors hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 focus:ring-offset-background disabled:opacity-40"
        >
          {isStreaming ? <Square className="h-4 w-4" /> : <Send className="h-4 w-4" />}
        </button>
      </div>
    </div>
  );
}
