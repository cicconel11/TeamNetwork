export const CUSTOMIZATION_TIMEZONE_OPTION_KEYS = [
  { value: "America/New_York", key: "newYork" },
  { value: "America/Chicago", key: "chicago" },
  { value: "America/Denver", key: "denver" },
  { value: "America/Los_Angeles", key: "losAngeles" },
  { value: "America/Anchorage", key: "anchorage" },
  { value: "Pacific/Honolulu", key: "honolulu" },
  { value: "America/Phoenix", key: "phoenix" },
  { value: "America/Toronto", key: "toronto" },
  { value: "America/Vancouver", key: "vancouver" },
  { value: "America/Mexico_City", key: "mexicoCity" },
  { value: "Europe/London", key: "london" },
  { value: "Europe/Berlin", key: "berlin" },
  { value: "Europe/Paris", key: "paris" },
  { value: "Asia/Tokyo", key: "tokyo" },
  { value: "Asia/Shanghai", key: "shanghai" },
  { value: "Asia/Kolkata", key: "kolkata" },
  { value: "Asia/Dubai", key: "dubai" },
  { value: "Australia/Sydney", key: "sydney" },
  { value: "Pacific/Auckland", key: "auckland" },
  { value: "UTC", key: "utc" },
] as const;

export function getCustomizationTimezoneOptions(
  getLabel: (key: string) => string,
): Array<{ value: string; label: string }> {
  return CUSTOMIZATION_TIMEZONE_OPTION_KEYS.map(({ value, key }) => ({
    value,
    label: getLabel(`timezone.options.${key}`),
  }));
}
