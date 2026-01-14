"use client";

import { useState } from "react";

interface PollComposerProps {
  onCreatePoll: (data: { question: string; options: string[]; allow_change: boolean }) => void;
  onCancel: () => void;
  isSubmitting?: boolean;
}

export function PollComposer({ onCreatePoll, onCancel, isSubmitting }: PollComposerProps) {
  const [question, setQuestion] = useState("");
  const [options, setOptions] = useState(["", ""]);
  const [allowChange, setAllowChange] = useState(true);

  const isValid =
    question.trim().length > 0 && options.filter((o) => o.trim().length > 0).length >= 2;

  const handleSubmit = () => {
    if (!isValid || isSubmitting) return;
    onCreatePoll({
      question: question.trim(),
      options: options.filter((o) => o.trim()),
      allow_change: allowChange,
    });
  };

  return (
    <div
      className="border-t border-[var(--border)] bg-[var(--card)] p-4 animate-slide-up"
      style={{ overscrollBehavior: "contain" }}
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold">Create Poll</h3>
        <button
          aria-label="Close poll composer"
          onClick={onCancel}
          className="h-8 w-8 rounded-lg hover:bg-muted flex items-center justify-center
            focus-visible:ring-2 focus-visible:ring-[var(--color-org-primary)] focus-visible:outline-none
            transition-colors duration-200"
        >
          <svg
            className="h-4 w-4 text-muted-foreground"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Question input */}
      <input
        type="text"
        value={question}
        onChange={(e) => setQuestion(e.target.value)}
        placeholder="Ask a question..."
        maxLength={500}
        autoFocus
        className="w-full px-3 py-2 rounded-lg bg-muted border border-[var(--border)] text-sm
          focus:ring-2 focus:ring-[var(--color-org-primary)] focus:outline-none mb-3
          placeholder:text-muted-foreground"
      />

      {/* Options */}
      <div className="space-y-2 mb-3">
        {options.map((opt, i) => (
          <div key={i} className="flex gap-2 items-center">
            <input
              type="text"
              value={opt}
              onChange={(e) => {
                setOptions(prev => prev.map((o, j) => j === i ? e.target.value : o));
              }}
              placeholder={`Option ${i + 1}...`}
              maxLength={200}
              className="flex-1 px-3 py-2 rounded-lg bg-muted border border-[var(--border)] text-sm
                focus:ring-2 focus:ring-[var(--color-org-primary)] focus:outline-none
                placeholder:text-muted-foreground"
            />
            {options.length > 2 && (
              <button
                aria-label={`Remove option ${i + 1}`}
                onClick={() => setOptions((prev) => prev.filter((_, j) => j !== i))}
                className="h-8 w-8 rounded-lg hover:bg-red-500/10 flex items-center justify-center flex-shrink-0
                  focus-visible:ring-2 focus-visible:ring-[var(--color-org-primary)] focus-visible:outline-none
                  transition-colors duration-200"
              >
                <svg
                  className="h-4 w-4 text-muted-foreground"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>
        ))}
      </div>

      {/* Add option button */}
      {options.length < 6 && (
        <button
          onClick={() => setOptions((prev) => [...prev, ""])}
          className="text-sm text-[var(--color-org-secondary)] hover:opacity-80 transition-colors duration-200 mb-3
            focus-visible:ring-2 focus-visible:ring-[var(--color-org-primary)] focus-visible:outline-none rounded"
        >
          + Add Option
        </button>
      )}

      {/* Allow change toggle */}
      <label className="flex items-center gap-2 text-sm text-[var(--foreground)] cursor-pointer mb-3">
        <input
          type="checkbox"
          checked={allowChange}
          onChange={(e) => setAllowChange(e.target.checked)}
          className="accent-[var(--color-org-secondary)]"
        />
        Allow voters to change their answer
      </label>

      {/* Footer */}
      <div className="flex justify-end gap-2">
        <button
          onClick={onCancel}
          className="px-4 py-2 rounded-lg bg-muted text-sm font-medium
            hover:bg-[var(--border)] transition-colors duration-200
            focus-visible:ring-2 focus-visible:ring-[var(--color-org-primary)] focus-visible:outline-none"
        >
          Cancel
        </button>
        <button
          onClick={handleSubmit}
          disabled={!isValid || isSubmitting}
          className="px-4 py-2 rounded-lg bg-[var(--color-org-secondary)] text-[var(--color-org-secondary-foreground)] text-sm font-medium
            hover:opacity-90 transition-colors duration-200
            disabled:opacity-50 disabled:cursor-not-allowed
            focus-visible:ring-2 focus-visible:ring-[var(--color-org-primary)] focus-visible:outline-none"
        >
          {isSubmitting ? (
            <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-current" />
          ) : (
            "Create Poll"
          )}
        </button>
      </div>
    </div>
  );
}
