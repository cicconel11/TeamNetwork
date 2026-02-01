import type { AgeBracket } from "@/lib/schemas/age-gate";

/**
 * Calculate age from a birth date
 * @param birthDate - The date of birth
 * @returns Age in years
 */
export function calculateAge(birthDate: Date): number {
  const today = new Date();
  let age = today.getFullYear() - birthDate.getFullYear();
  const monthDiff = today.getMonth() - birthDate.getMonth();

  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
    age--;
  }

  return age;
}

/**
 * Derive age bracket from age for COPPA compliance
 * @param age - Age in years
 * @returns Age bracket: under_13, 13_17, or 18_plus
 */
export function deriveAgeBracket(age: number): AgeBracket {
  if (age < 13) {
    return "under_13";
  }
  if (age < 18) {
    return "13_17";
  }
  return "18_plus";
}
