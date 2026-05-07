"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";

const TAG_REGEX = /^[a-zA-Z0-9\s\-_]+$/;

interface TagInputProps {
  tags: string[];
  onChange: (tags: string[]) => void;
  suggestions?: string[];
  maxTags?: number;
  disabled?: boolean;
  placeholder?: string;
}

export function TagInput({
  tags,
  onChange,
  suggestions = [],
  maxTags = 20,
  disabled = false,
  placeholder = "Add tag...",
}: TagInputProps) {
  const [input, setInput] = useState("");
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const listboxId = useId();

  const filtered = input.trim()
    ? suggestions.filter(
        (s) =>
          s.toLowerCase().startsWith(input.trim().toLowerCase()) &&
          !tags.includes(s.toLowerCase()),
      )
    : [];

  const showDropdown = open && filtered.length > 0;

  const commitTag = useCallback(
    (raw: string) => {
      const value = raw.trim().toLowerCase();
      if (!value) return;
      if (!TAG_REGEX.test(value)) return;
      if (value.length > 50) return;
      if (tags.includes(value)) return;
      if (tags.length >= maxTags) return;
      onChange([...tags, value]);
      setInput("");
      setActiveIndex(-1);
    },
    [tags, onChange, maxTags],
  );

  const removeTag = useCallback(
    (index: number) => {
      onChange(tags.filter((_, i) => i !== index));
    },
    [tags, onChange],
  );

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      if (showDropdown && activeIndex >= 0) {
        commitTag(filtered[activeIndex]);
      } else {
        commitTag(input);
      }
    } else if (e.key === "Backspace" && !input && tags.length > 0) {
      removeTag(tags.length - 1);
    } else if (e.key === "Escape") {
      setOpen(false);
      setActiveIndex(-1);
    } else if (e.key === "ArrowDown" && showDropdown) {
      e.preventDefault();
      setActiveIndex((prev) => Math.min(prev + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp" && showDropdown) {
      e.preventDefault();
      setActiveIndex((prev) => Math.max(prev - 1, 0));
    }
  };

  // Close dropdown on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (inputRef.current && !inputRef.current.closest("[data-tag-input]")?.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  return (
    <div data-tag-input className="relative">
      <div
        className={`flex flex-wrap items-center gap-1.5 px-2.5 py-1.5 rounded-xl border border-[var(--border)] bg-[var(--card)] min-h-[38px] ${
          disabled ? "opacity-50 pointer-events-none" : ""
        } focus-within:ring-2 focus-within:border-transparent`}
        style={{ "--tw-ring-color": "var(--color-org-primary)" } as React.CSSProperties}
        onClick={() => inputRef.current?.focus()}
      >
        {tags.map((tag, i) => (
          <span
            key={tag}
            className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-full bg-[var(--muted)] text-[var(--foreground)]"
          >
            {tag}
            {!disabled && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  removeTag(i);
                }}
                className="w-3.5 h-3.5 flex items-center justify-center rounded-full hover:bg-[var(--border)] transition-colors"
                aria-label={`Remove tag ${tag}`}
              >
                <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </span>
        ))}
        <input
          ref={inputRef}
          role="combobox"
          aria-expanded={showDropdown}
          aria-controls={listboxId}
          aria-activedescendant={showDropdown && activeIndex >= 0 ? `${listboxId}-${activeIndex}` : undefined}
          type="text"
          value={input}
          onChange={(e) => {
            setInput(e.target.value);
            setOpen(true);
            setActiveIndex(-1);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={handleKeyDown}
          disabled={disabled}
          placeholder={tags.length === 0 ? placeholder : tags.length >= maxTags ? "Max tags reached" : ""}
          className="flex-1 min-w-[80px] bg-transparent text-sm text-[var(--foreground)] placeholder:text-[var(--muted-foreground)] outline-none"
        />
      </div>

      {showDropdown && (
        <ul
          id={listboxId}
          role="listbox"
          className="absolute z-50 top-full left-0 right-0 mt-1 max-h-40 overflow-y-auto rounded-xl border border-[var(--border)] bg-[var(--card)] shadow-lg py-1"
        >
          {filtered.map((suggestion, i) => (
            <li
              key={suggestion}
              id={`${listboxId}-${i}`}
              role="option"
              aria-selected={i === activeIndex}
              className={`px-3 py-1.5 text-sm cursor-pointer transition-colors ${
                i === activeIndex
                  ? "bg-[var(--muted)] text-[var(--foreground)]"
                  : "text-[var(--muted-foreground)] hover:bg-[var(--muted)] hover:text-[var(--foreground)]"
              }`}
              onMouseDown={(e) => {
                e.preventDefault();
                commitTag(suggestion);
              }}
              onMouseEnter={() => setActiveIndex(i)}
            >
              {suggestion}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
