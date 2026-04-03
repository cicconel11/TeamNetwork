"use client";

type TimeZoneProps = {
  iso: string;
  timeZone?: string;
};

export function LocalDate({ iso, options, timeZone }: TimeZoneProps & { options?: Intl.DateTimeFormatOptions }) {
  const date = new Date(iso);
  const opts = timeZone ? { ...options, timeZone } : options;
  return <>{date.toLocaleDateString("en-US", opts)}</>;
}

export function LocalTime({ iso, options, timeZone }: TimeZoneProps & { options?: Intl.DateTimeFormatOptions }) {
  const date = new Date(iso);
  const defaultOpts: Intl.DateTimeFormatOptions = { hour: "numeric", minute: "2-digit" };
  const base = options ?? defaultOpts;
  const opts = timeZone ? { ...base, timeZone } : base;
  return <>{date.toLocaleTimeString("en-US", opts)}</>;
}

export function LocalDateDay({ iso, timeZone }: TimeZoneProps) {
  const date = new Date(iso);
  if (timeZone) {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone, day: "numeric" }).formatToParts(date);
    return <>{parts.find((p) => p.type === "day")?.value ?? date.getDate()}</>;
  }
  return <>{date.getDate()}</>;
}

export function LocalDateMonth({ iso, timeZone }: TimeZoneProps) {
  const date = new Date(iso);
  const opts: Intl.DateTimeFormatOptions = { month: "short" };
  if (timeZone) opts.timeZone = timeZone;
  return <>{date.toLocaleDateString("en-US", opts)}</>;
}
