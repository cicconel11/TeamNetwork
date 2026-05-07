"use client";

import { useState } from "react";
import { UserContent } from "@/components/i18n/UserContent";
import type { ChatMessage, ChatFormResponse } from "@/types/database";
import { formMetadataSchema, type FormMetadata, type ChatFormField } from "@/lib/schemas/chat-polls";

interface InlineFormMessageProps {
  message: ChatMessage;
  currentUserId: string;
  ownResponse?: ChatFormResponse | null;
  responseCount?: number;
  onSubmit?: (
    messageId: string,
    responses: Record<string, string>
  ) => Promise<{ ok: boolean; error?: string }> | { ok: boolean; error?: string } | void;
}

function getSubmittedValues(
  ownResponse: ChatFormResponse,
  fields: ChatFormField[]
): Record<string, string> {
  if (!ownResponse.responses || typeof ownResponse.responses !== "object" || Array.isArray(ownResponse.responses)) {
    return {};
  }
  const responses = ownResponse.responses as Record<string, unknown>;
  return fields.reduce<Record<string, string>>((acc, field) => {
    const value = responses[field.id];
    return { ...acc, [field.id]: typeof value === "string" ? value : "" };
  }, {});
}

export function InlineFormMessage({
  message,
  ownResponse,
  responseCount,
  onSubmit,
}: InlineFormMessageProps) {
  const parsed = formMetadataSchema.passthrough().safeParse(message.metadata);
  const metadata: FormMetadata | null = parsed.success ? parsed.data : null;

  const initialValues =
    metadata?.fields.reduce<Record<string, string>>((acc, field) => {
      return { ...acc, [field.id]: "" };
    }, {}) ?? {};

  const [values, setValues] = useState<Record<string, string>>(initialValues);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  if (!metadata) {
    return (
      <p className="whitespace-pre-wrap break-words text-sm text-muted-foreground">
        [Invalid form]
      </p>
    );
  }

  const isValid = metadata.fields
    .filter((f) => f.required)
    .every((f) => (values[f.id] ?? "").trim().length > 0);

  const handleSubmit = async () => {
    if (!isValid || isSubmitting) return;
    setIsSubmitting(true);
    setSubmitError(null);
    try {
      const result = await onSubmit?.(message.id, values);
      if (result && typeof result === "object" && "ok" in result && !result.ok) {
        setSubmitError(result.error || "Failed to submit response");
      }
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : "Failed to submit response");
    } finally {
      setIsSubmitting(false);
    }
  };

  if (ownResponse) {
    const submittedValues = getSubmittedValues(ownResponse, metadata.fields);

    return (
      <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] overflow-hidden max-w-full">
        <div className="p-3 border-b border-[var(--border)] flex items-center justify-between">
          <UserContent as="h4" className="text-sm font-semibold text-foreground">
            {metadata.title}
          </UserContent>
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-[var(--color-org-secondary)]/10 text-[var(--color-org-secondary)] text-xs font-medium">
            Submitted
          </span>
        </div>

        <div className="p-3 space-y-3">
          {metadata.fields.map((field) => (
            <div key={field.id}>
              <span className="text-xs font-medium text-muted-foreground block mb-0.5">
                <UserContent>{field.label}</UserContent>
              </span>
              <span className="text-sm text-foreground">
                {submittedValues[field.id] ? (
                  <UserContent>{submittedValues[field.id]}</UserContent>
                ) : (
                  <span className="text-muted-foreground italic">No answer</span>
                )}
              </span>
            </div>
          ))}
        </div>

        {responseCount !== undefined && responseCount > 0 && (
          <div className="px-3 py-2 border-t border-[var(--border)] bg-muted/50">
            <span className="text-xs text-muted-foreground">
              {responseCount} response{responseCount !== 1 ? "s" : ""}
            </span>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] overflow-hidden max-w-full">
      <div className="p-3 border-b border-[var(--border)]">
        <UserContent as="h4" className="text-sm font-semibold text-foreground">
          {metadata.title}
        </UserContent>
      </div>

      <div className="p-3 space-y-3">
        {metadata.fields.map((field) => (
          <label key={field.id} className="block">
            <span className="text-xs font-medium text-muted-foreground mb-1 block">
              <UserContent>{field.label}</UserContent>
              {field.required && <span className="text-red-500 ml-0.5">*</span>}
            </span>

            {field.type === "text" && (
              <input
                type="text"
                value={values[field.id] ?? ""}
                onChange={(e) =>
                  setValues((prev) => ({ ...prev, [field.id]: e.target.value }))
                }
                placeholder={`${field.label}...`}
                translate="yes"
                lang="und"
                aria-required={field.required}
                autoComplete="off"
                spellCheck={false}
                maxLength={2000}
                className="w-full px-3 py-2 rounded-lg bg-muted border border-[var(--border)] focus:ring-2 focus:ring-[var(--color-org-primary)] focus:outline-none text-sm"
              />
            )}

            {field.type === "select" && field.options && (
              <select
                value={values[field.id] ?? ""}
                onChange={(e) =>
                  setValues((prev) => ({ ...prev, [field.id]: e.target.value }))
                }
                aria-required={field.required}
                className="w-full px-3 py-2 rounded-lg bg-muted border border-[var(--border)] focus:ring-2 focus:ring-[var(--color-org-primary)] focus:outline-none text-sm"
                style={{ backgroundColor: "var(--muted)", color: "var(--foreground)" }}
              >
                <option value="">Select...</option>
                {field.options.map((opt) => (
                  <option key={opt} value={opt} translate="yes" lang="und">
                    {opt}
                  </option>
                ))}
              </select>
            )}

            {field.type === "radio" && field.options && (
              <div className="flex flex-col gap-2 mt-1">
                {field.options.map((opt) => (
                  <label key={opt} className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name={`${message.id}-${field.id}`}
                      value={opt}
                      checked={values[field.id] === opt}
                      onChange={(e) =>
                        setValues((prev) => ({ ...prev, [field.id]: e.target.value }))
                      }
                      className="accent-[var(--color-org-secondary)]"
                    />
                    <UserContent as="span" className="text-sm">
                      {opt}
                    </UserContent>
                  </label>
                ))}
              </div>
            )}
          </label>
        ))}
      </div>

      <div className="p-3 border-t border-[var(--border)] flex items-center justify-between">
        <button
          type="button"
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
            "Submit"
          )}
        </button>
        {responseCount !== undefined && responseCount > 0 && (
          <span className="text-xs text-muted-foreground">
            {responseCount} response{responseCount !== 1 ? "s" : ""}
          </span>
        )}
      </div>
      {submitError && (
        <p className="px-3 pb-3 text-xs text-red-500">{submitError}</p>
      )}
    </div>
  );
}
