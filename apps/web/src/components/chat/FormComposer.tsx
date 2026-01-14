"use client";

import { useState } from "react";

interface FieldState {
  id: string;
  label: string;
  type: "text" | "select" | "radio";
  required: boolean;
  optionsText: string;
}

interface FormComposerProps {
  onCreateForm: (data: {
    title: string;
    fields: Array<{
      id: string;
      label: string;
      type: "text" | "select" | "radio";
      required: boolean;
      options?: string[];
    }>;
  }) => void;
  onCancel: () => void;
  isSubmitting?: boolean;
}

function generateId(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return Date.now().toString();
}

function createEmptyField(): FieldState {
  return {
    id: generateId(),
    label: "",
    type: "text",
    required: false,
    optionsText: "",
  };
}

export function FormComposer({ onCreateForm, onCancel, isSubmitting }: FormComposerProps) {
  const [title, setTitle] = useState("");
  const [fields, setFields] = useState<FieldState[]>([createEmptyField()]);
  const [optionsError, setOptionsError] = useState<string | null>(null);

  const isValid =
    title.trim().length > 0 && fields.some((f) => f.label.trim().length > 0);

  const updateField = (index: number, updates: Partial<FieldState>) => {
    if ("optionsText" in updates) {
      setOptionsError(null);
    }
    setFields((prev) => prev.map((f, i) => (i === index ? { ...f, ...updates } : f)));
  };

  const addField = () => {
    setFields((prev) => [...prev, createEmptyField()]);
  };

  const removeField = (index: number) => {
    setFields((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSubmit = () => {
    if (!isValid || isSubmitting) return;
    const cleanedFields: Array<{
      id: string;
      label: string;
      type: "text" | "select" | "radio";
      required: boolean;
      options?: string[];
    }> = [];

    for (const field of fields.filter((f) => f.label.trim().length > 0)) {
      const cleanedField = {
        id: field.id,
        label: field.label.trim(),
        type: field.type,
        required: field.required,
      } as {
        id: string;
        label: string;
        type: "text" | "select" | "radio";
        required: boolean;
        options?: string[];
      };

      if (field.type === "select" || field.type === "radio") {
        const options = field.optionsText
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
        if (options.length > 20) {
          setOptionsError(`"${field.label.trim() || "Field"}" has too many options (max 20).`);
          return;
        }
        cleanedField.options = options;
      }

      cleanedFields.push(cleanedField);
    }

    setOptionsError(null);
    onCreateForm({
      title: title.trim(),
      fields: cleanedFields,
    });
  };

  return (
    <div
      className="border-t border-[var(--border)] bg-[var(--card)] p-4 animate-slide-up"
      style={{ overscrollBehavior: "contain" }}
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold">Create Form</h3>
        <button
          aria-label="Close form composer"
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

      {/* Title */}
      <input
        type="text"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Form title..."
        maxLength={300}
        autoFocus
        className="w-full px-3 py-2 rounded-lg bg-muted border border-[var(--border)] text-sm
          focus:ring-2 focus:ring-[var(--color-org-primary)] focus:outline-none mb-3
          placeholder:text-muted-foreground"
      />

      {/* Fields */}
      <div className="space-y-3 mb-3 max-h-48 overflow-y-auto">
        {fields.map((field, i) => (
          <div key={field.id}>
            <div className="flex gap-2 items-start">
              <input
                type="text"
                value={field.label}
                onChange={(e) => updateField(i, { label: e.target.value })}
                placeholder={`Field ${i + 1} label...`}
                maxLength={200}
                className="flex-1 px-3 py-2 rounded-lg bg-muted border border-[var(--border)] text-sm
                  focus:ring-2 focus:ring-[var(--color-org-primary)] focus:outline-none
                  placeholder:text-muted-foreground"
              />
              <select
                value={field.type}
                onChange={(e) =>
                  updateField(i, { type: e.target.value as "text" | "select" | "radio" })
                }
                className="px-2 py-2 rounded-lg bg-muted border border-[var(--border)] text-sm
                  focus:ring-2 focus:ring-[var(--color-org-primary)] focus:outline-none"
                style={{ backgroundColor: "var(--muted)", color: "var(--foreground)" }}
              >
                <option value="text">Text</option>
                <option value="select">Select</option>
                <option value="radio">Radio</option>
              </select>
              <label className="flex items-center gap-1 text-xs text-muted-foreground cursor-pointer whitespace-nowrap py-2">
                <input
                  type="checkbox"
                  checked={field.required}
                  onChange={(e) => updateField(i, { required: e.target.checked })}
                  className="accent-[var(--color-org-secondary)]"
                />
                Req
              </label>
              {fields.length > 1 && (
                <button
                  aria-label={`Remove field ${i + 1}`}
                  onClick={() => removeField(i)}
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
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M6 18L18 6M6 6l12 12"
                    />
                  </svg>
                </button>
              )}
            </div>
            {(field.type === "select" || field.type === "radio") && (
              <input
                type="text"
                value={field.optionsText}
                onChange={(e) => updateField(i, { optionsText: e.target.value })}
                placeholder="Option 1, Option 2..."
                className="w-full px-3 py-1.5 rounded-lg bg-muted border border-[var(--border)] text-xs mt-1
                  focus:ring-2 focus:ring-[var(--color-org-primary)] focus:outline-none
                  placeholder:text-muted-foreground"
              />
            )}
          </div>
        ))}
      </div>

      {/* Add field */}
      {fields.length < 10 && (
        <button
          onClick={addField}
          className="text-sm text-[var(--color-org-secondary)] hover:opacity-80 transition-colors duration-200 mb-3
            focus-visible:ring-2 focus-visible:ring-[var(--color-org-primary)] focus-visible:outline-none rounded"
        >
          + Add Field
        </button>
      )}

      {/* Footer */}
      <div className="flex justify-end gap-2">
        <button
          onClick={onCancel}
          className="px-4 py-2 rounded-lg bg-muted text-sm font-medium hover:bg-[var(--border)] transition-colors duration-200
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
            "Create Form"
          )}
        </button>
      </div>
      {optionsError && (
        <p className="mt-2 text-xs text-red-500">{optionsError}</p>
      )}
    </div>
  );
}
