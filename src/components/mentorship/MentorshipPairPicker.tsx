"use client";

interface PairOption {
  id: string;
  mentorName: string;
  menteeName: string;
  mentorUserId?: string;
  menteeUserId?: string;
}

interface MentorshipPairPickerProps {
  pairs: PairOption[];
  selectedPairId: string;
  onPairChange: (pairId: string) => void;
  currentUserId?: string;
}

export function MentorshipPairPicker({
  pairs,
  selectedPairId,
  onPairChange,
  currentUserId,
}: MentorshipPairPickerProps) {
  if (pairs.length <= 1) return null;

  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-2">
      {pairs.map((pair) => {
        const isSelected = selectedPairId === pair.id;
        const youAreMentor = !!currentUserId && pair.mentorUserId === currentUserId;
        const youAreMentee = !!currentUserId && pair.menteeUserId === currentUserId;

        return (
          <button
            key={pair.id}
            type="button"
            data-testid={`mentorship-pair-chip-${pair.id}`}
            onClick={() => onPairChange(pair.id)}
            aria-pressed={isSelected}
            className={`group flex flex-col gap-1.5 rounded-lg border px-3 py-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${
              isSelected
                ? "border-foreground bg-foreground/5"
                : "border-border/60 bg-muted/20 hover:border-border hover:bg-muted/40"
            }`}
          >
            <PairRow
              role="Mentor"
              name={pair.mentorName}
              isYou={youAreMentor}
              isSelected={isSelected}
            />
            <PairRow
              role="Mentee"
              name={pair.menteeName}
              isYou={youAreMentee}
              isSelected={isSelected}
            />
          </button>
        );
      })}
    </div>
  );
}

function PairRow({
  role,
  name,
  isYou,
  isSelected,
}: {
  role: "Mentor" | "Mentee";
  name: string;
  isYou: boolean;
  isSelected: boolean;
}) {
  return (
    <div className="flex items-center gap-2 min-w-0">
      <span
        className={`shrink-0 text-[10px] font-semibold uppercase tracking-wider w-14 ${
          isSelected ? "text-foreground/70" : "text-muted-foreground"
        }`}
      >
        {role}
      </span>
      <span
        className={`flex-1 min-w-0 truncate text-sm ${
          isSelected ? "text-foreground" : "text-foreground/80"
        } ${isYou ? "font-semibold" : "font-normal"}`}
      >
        {name}
      </span>
      {isYou && (
        <span className="shrink-0 rounded-full bg-foreground/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-foreground">
          You
        </span>
      )}
    </div>
  );
}
