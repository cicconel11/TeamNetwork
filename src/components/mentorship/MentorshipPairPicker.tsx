"use client";

import { Select } from "@/components/ui/select";

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

  const options = pairs.map((pair) => ({
    value: pair.id,
    label: `${pair.mentorName} → ${pair.menteeName}`,
  }));

  return (
    <Select
      value={selectedPairId}
      onChange={(e) => onPairChange(e.currentTarget.value)}
      options={options}
    />
  );
}
