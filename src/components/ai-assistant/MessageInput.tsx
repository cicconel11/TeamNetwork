"use client";

import { useState, useRef, useCallback } from "react";
import { Send, Square, AlertCircle } from "lucide-react";

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
    <div className="border-t border-gray-200 p-3 dark:border-gray-700">
      {error && (
        <div className="mb-2 flex items-center gap-2 rounded-md bg-red-50 px-3 py-2 text-xs text-red-700 dark:bg-red-900/20 dark:text-red-400">
          <AlertCircle className="h-3.5 w-3.5 shrink-0" />
          <span className="flex-1">{error}</span>
          <button onClick={onClearError} className="text-red-500 hover:text-red-700">Dismiss</button>
        </div>
      )}
      {isStreaming && (
        <div className="mb-2 flex items-center justify-between text-xs text-gray-500">
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 animate-pulse rounded-full bg-indigo-500" />
            Thinking...
          </span>
          <button
            onClick={onCancel}
            className="flex items-center gap-1 text-red-500 hover:text-red-700"
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
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ask about your organization..."
          disabled={isStreaming}
          rows={1}
          className="flex-1 resize-none rounded-md border border-gray-300 bg-white px-3 py-2 text-sm placeholder-gray-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 disabled:opacity-50 dark:border-gray-600 dark:bg-gray-800 dark:text-white dark:placeholder-gray-500"
        />
        <button
          onClick={isStreaming ? onCancel : handleSend}
          disabled={!isStreaming && !input.trim()}
          aria-label={isStreaming ? "Stop generation" : "Send message"}
          className="rounded-md bg-indigo-600 p-2 text-white hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 disabled:opacity-50 dark:focus:ring-offset-gray-900"
        >
          {isStreaming ? <Square className="h-4 w-4" /> : <Send className="h-4 w-4" />}
        </button>
      </div>
    </div>
  );
}
