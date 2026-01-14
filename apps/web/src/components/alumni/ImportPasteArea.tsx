"use client";

import { Button } from "@/components/ui";

interface ImportPasteAreaProps {
  showPaste: boolean;
  pasteText: string;
  placeholder: string;
  onToggle: () => void;
  onChange: (text: string) => void;
  onSubmit: () => void;
}

export function ImportPasteArea({ showPaste, pasteText, placeholder, onToggle, onChange, onSubmit }: ImportPasteAreaProps) {
  return (
    <>
      <button
        type="button"
        onClick={onToggle}
        className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors duration-150 mx-auto"
      >
        <svg className={`h-3 w-3 transition-transform duration-150 ${showPaste ? "rotate-90" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
        </svg>
        Or paste from spreadsheet
      </button>

      {showPaste && (
        <div className="space-y-3">
          <textarea
            value={pasteText}
            onChange={(e) => onChange(e.target.value)}
            placeholder={placeholder}
            rows={4}
            spellCheck={false}
            className="w-full rounded-lg border border-border bg-transparent px-3 py-2.5 text-xs font-mono text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:ring-2 focus:ring-org-secondary/50 focus:border-org-secondary/50 resize-y transition-colors duration-150"
          />
          <Button
            size="sm"
            onClick={onSubmit}
            disabled={!pasteText.trim()}
          >
            Preview
          </Button>
        </div>
      )}
    </>
  );
}
