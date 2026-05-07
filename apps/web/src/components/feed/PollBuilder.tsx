"use client";

interface PollBuilderProps {
  options: string[];
  onOptionsChange: (opts: string[]) => void;
  allowChange: boolean;
  onAllowChangeToggle: (v: boolean) => void;
}

export function PollBuilder({
  options,
  onOptionsChange,
  allowChange,
  onAllowChangeToggle,
}: PollBuilderProps) {
  const updateOption = (index: number, value: string) => {
    const next = [...options];
    next[index] = value;
    onOptionsChange(next);
  };

  const removeOption = (index: number) => {
    if (options.length <= 2) return;
    onOptionsChange(options.filter((_, i) => i !== index));
  };

  const addOption = () => {
    if (options.length >= 6) return;
    onOptionsChange([...options, ""]);
  };

  return (
    <div className="mt-3 rounded-xl border border-border/60 bg-muted/20 p-3 space-y-3">
      <div className="space-y-2">
        {options.map((opt, i) => (
          <div key={i} className="flex items-center gap-2">
            <div className="flex items-center gap-2 flex-1 rounded-xl border border-border/40 bg-background pl-3 pr-1 focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-1">
              <span className="text-xs font-mono text-muted-foreground/60 shrink-0">{i + 1}</span>
              <input
                value={opt}
                onChange={(e) => updateOption(i, e.target.value)}
                placeholder={`Option ${i + 1}`}
                maxLength={200}
                className="flex-1 py-2 text-sm bg-transparent outline-none placeholder:text-muted-foreground/40"
                aria-label={`Option ${i + 1}`}
              />
              {options.length > 2 && (
                <button
                  type="button"
                  onClick={() => removeOption(i)}
                  className="p-1.5 rounded-lg text-muted-foreground/40 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors"
                  aria-label={`Remove option ${i + 1}`}
                >
                  <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      {options.length < 6 && (
        <button
          type="button"
          onClick={addOption}
          className="text-xs font-medium text-org-primary hover:text-org-primary/80 transition-colors"
        >
          + Add option
        </button>
      )}

      <label className="flex items-center gap-2 pt-1 cursor-pointer">
        <input
          type="checkbox"
          checked={allowChange}
          onChange={(e) => onAllowChangeToggle(e.target.checked)}
          className="rounded border-border text-org-primary focus:ring-org-primary h-3.5 w-3.5"
        />
        <span className="text-xs text-muted-foreground">Allow voters to change their answer</span>
      </label>
    </div>
  );
}
