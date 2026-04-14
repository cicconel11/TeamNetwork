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
    <div className="flex flex-wrap gap-2">
      {pairs.map((pair) => (
        <button
          key={pair.id}
          onClick={() => onPairChange(pair.id)}
          className={`px-3.5 py-2 text-sm font-medium rounded-full transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${
            selectedPairId === pair.id
              ? "bg-foreground text-background shadow-md"
              : "bg-muted/50 text-foreground hover:bg-muted border border-muted/60 hover:border-muted"
          }`}
          aria-pressed={selectedPairId === pair.id}
        >
          <span className="font-medium">{pair.mentorName}</span>
          <span className="mx-1.5 text-muted-foreground/60">↔</span>
          <span>{pair.menteeName}</span>
        </button>
      ))}
    </div>
  );
}
