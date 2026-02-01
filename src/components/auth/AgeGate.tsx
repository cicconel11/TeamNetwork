"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { Button, Card, Select } from "@/components/ui";
import { ageGateSchema, type AgeBracket } from "@/lib/schemas/auth";
import { calculateAge, deriveAgeBracket } from "@/lib/auth/age-gate";

interface AgeGateProps {
  onComplete: (ageBracket: AgeBracket, isMinor: boolean) => void;
}

const MONTHS = [
  { value: "", label: "Month", disabled: true },
  { value: "1", label: "January" },
  { value: "2", label: "February" },
  { value: "3", label: "March" },
  { value: "4", label: "April" },
  { value: "5", label: "May" },
  { value: "6", label: "June" },
  { value: "7", label: "July" },
  { value: "8", label: "August" },
  { value: "9", label: "September" },
  { value: "10", label: "October" },
  { value: "11", label: "November" },
  { value: "12", label: "December" },
];

interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

function generateDayOptions(): SelectOption[] {
  const options: SelectOption[] = [{ value: "", label: "Day", disabled: true }];
  for (let i = 1; i <= 31; i++) {
    options.push({ value: String(i), label: String(i) });
  }
  return options;
}

function generateYearOptions(): SelectOption[] {
  const currentYear = new Date().getFullYear();
  const options: SelectOption[] = [{ value: "", label: "Year", disabled: true }];
  for (let year = currentYear; year >= 1900; year--) {
    options.push({ value: String(year), label: String(year) });
  }
  return options;
}

export function AgeGate({ onComplete }: AgeGateProps) {
  const [month, setMonth] = useState("");
  const [day, setDay] = useState("");
  const [year, setYear] = useState("");
  const [error, setError] = useState<string | null>(null);

  const dayOptions = useMemo(() => generateDayOptions(), []);
  const yearOptions = useMemo(() => generateYearOptions(), []);

  const isFormFilled = month !== "" && day !== "" && year !== "";

  const validateAndProceed = () => {
    setError(null);

    const formData = {
      month: parseInt(month, 10),
      day: parseInt(day, 10),
      year: parseInt(year, 10),
    };

    const result = ageGateSchema.safeParse(formData);

    if (!result.success) {
      setError(result.error.issues[0]?.message || "Please enter a valid date");
      return;
    }

    const birthDate = new Date(formData.year, formData.month - 1, formData.day);
    const age = calculateAge(birthDate);
    const ageBracket = deriveAgeBracket(age);
    const isMinor = age < 18;

    onComplete(ageBracket, isMinor);
  };

  return (
    <Card className="p-6">
      <div className="mb-6">
        <h2 className="text-lg font-semibold text-foreground mb-2">Date of Birth</h2>
        <p className="text-sm text-muted-foreground">
          Please enter your date of birth to continue.
        </p>
      </div>

      {error && (
        <div
          data-testid="age-gate-error"
          className="mb-4 p-3 rounded-xl bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 text-sm"
        >
          {error}
        </div>
      )}

      <div className="grid grid-cols-3 gap-3 mb-6">
        <Select
          label="Month"
          options={MONTHS}
          value={month}
          onChange={(e) => setMonth(e.target.value)}
          data-testid="age-gate-month"
        />
        <Select
          label="Day"
          options={dayOptions}
          value={day}
          onChange={(e) => setDay(e.target.value)}
          data-testid="age-gate-day"
        />
        <Select
          label="Year"
          options={yearOptions}
          value={year}
          onChange={(e) => setYear(e.target.value)}
          data-testid="age-gate-year"
        />
      </div>

      <Button
        type="button"
        className="w-full"
        disabled={!isFormFilled}
        onClick={validateAndProceed}
        data-testid="age-gate-continue"
      >
        Continue
      </Button>

      <div className="mt-6 text-center text-sm text-muted-foreground">
        Already have an account?{" "}
        <Link href="/auth/login" className="text-foreground font-medium hover:underline">
          Sign in
        </Link>
      </div>
    </Card>
  );
}
