"use client";

interface MentorshipPairPickerProps {
  pairs: Array<{ id: string; mentorName: string; menteeName: string }>;
  selectedPairId: string;
  onPairChange: (pairId: string) => void;
}

export function MentorshipPairPicker({
  pairs,
  selectedPairId,
  onPairChange,
}: MentorshipPairPickerProps) {
  // Only render when there's more than one pair
  if (pairs.length <= 1) {
    return null;
  }

  return (
    <div className="flex flex-wrap gap-1.5">
      {pairs.map((pair) => (
        <button
          key={pair.id}
          data-testid={`mentorship-pair-chip-${pair.id}`}
          onClick={() => onPairChange(pair.id)}
          className={`px-2.5 py-1 text-xs font-medium rounded-md transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${
            selectedPairId === pair.id
              ? "bg-foreground text-background"
              : "text-muted-foreground hover:text-foreground hover:bg-muted/60"
          }`}
          aria-pressed={selectedPairId === pair.id}
        >
          <span className="font-medium">{pair.mentorName}</span>
          <span className="mx-1 opacity-40">→</span>
          <span>{pair.menteeName}</span>
        </button>
      ))}
    </div>
  );
}
