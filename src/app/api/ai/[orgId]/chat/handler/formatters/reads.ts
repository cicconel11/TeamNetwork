import { getNonEmptyString, formatIsoDate, formatDisplayRow } from "./index";

interface AnnouncementDisplayRow {
  title?: unknown;
  published_at?: unknown;
  audience?: unknown;
  is_pinned?: unknown;
  body_preview?: unknown;
}

interface NavigationDisplayTarget {
  label?: unknown;
  href?: unknown;
  description?: unknown;
  kind?: unknown;
  userCanAccess?: unknown;
  manualSteps?: unknown;
  assistantCanHelpWith?: unknown;
}

interface NavigationDisplayPayload {
  state?: unknown;
  query?: unknown;
  matches?: unknown;
}

interface SuggestMentorsDisplayPayload {
  state?: unknown;
  mentee?: { name?: unknown } | null;
  suggestions?: unknown;
  disambiguation_options?: unknown;
}

interface SuggestMentorsDisplaySuggestion {
  mentor?: { name?: unknown; subtitle?: unknown } | null;
  reasons?: Array<{ label?: unknown; value?: unknown }>;
}

interface DonationAnalyticsDisplayPayload {
  window_days?: unknown;
  totals?: {
    successful_donation_count?: unknown;
    successful_amount_cents?: unknown;
    average_successful_amount_cents?: unknown;
    largest_successful_amount_cents?: unknown;
    latest_successful_donation_at?: unknown;
    status_counts?: {
      succeeded?: unknown;
      failed?: unknown;
      pending?: unknown;
    } | null;
  } | null;
  trend?: unknown;
  top_purposes?: unknown;
}

interface ListAvailableMentorsDisplayPayload {
  state?: unknown;
  total_available?: unknown;
  mentors?: unknown;
}

interface ListAvailableMentorsDisplayRow {
  mentor?: { name?: unknown; subtitle?: unknown } | null;
  open_slots?: unknown;
  current_mentee_count?: unknown;
  max_mentees?: unknown;
  sports?: unknown;
  positions?: unknown;
}

export interface DonationResponseOptions {
  hideDonorNames?: boolean;
}

export function formatSuggestMentorsResponse(data: unknown): string | null {
  if (!data || typeof data !== "object") return null;

  const payload = data as SuggestMentorsDisplayPayload;
  const state = getNonEmptyString(payload.state);
  if (!state) return null;

  if (state === "unauthorized") {
    return "Mentor suggestions are currently available to admins only.";
  }

  if (state === "not_found") {
    return "I couldn't find that person in the organization. Please share a full name or email.";
  }

  if (state === "ambiguous") {
    const options = Array.isArray(payload.disambiguation_options)
      ? payload.disambiguation_options
          .map((option) =>
            option && typeof option === "object"
              ? formatDisplayRow(option as { name?: unknown; subtitle?: unknown })
              : null
          )
          .filter((option): option is string => Boolean(option))
      : [];

    if (options.length === 0) return null;

    return `I found multiple matches. Which one did you mean?\n${options
      .map((option) => `- ${option}`)
      .join("\n")}`;
  }

  const menteeName = getNonEmptyString(payload.mentee?.name);
  if (!menteeName) return null;

  if (state === "no_suggestions") {
    return `I found ${menteeName}, but there are no eligible mentors matching their preferences right now.`;
  }

  if (state !== "resolved" || !Array.isArray(payload.suggestions)) return null;

  const suggestions = (payload.suggestions as SuggestMentorsDisplaySuggestion[])
    .map((s) => {
      if (!s || typeof s !== "object") return null;
      const name = getNonEmptyString(s.mentor?.name);
      if (!name) return null;

      const subtitle = getNonEmptyString(s.mentor?.subtitle);
      const displayLine = subtitle ? `${name} — ${subtitle}` : name;

      const reasons = Array.isArray(s.reasons)
        ? s.reasons
            .map((r) => {
              const label = getNonEmptyString(r?.label);
              if (!label) return null;
              const value = r?.value;
              return value != null && value !== "" ? `${label}: ${value}` : label;
            })
            .filter((r): r is string => Boolean(r))
        : [];

      if (reasons.length === 0) return null;
      return { displayLine, reasons };
    })
    .filter(
      (s): s is { displayLine: string; reasons: string[] } => Boolean(s)
    )
    .slice(0, 5);

  if (suggestions.length === 0) return null;

  const lines = [`Top mentors for ${menteeName}`];
  for (const [index, suggestion] of suggestions.entries()) {
    lines.push(`${index + 1}. ${suggestion.displayLine}`);
    lines.push(`   Why: ${suggestion.reasons.join(", ")}`);
  }

  return lines.join("\n");
}

export function formatDonationAnalyticsResponse(data: unknown): string | null {
  if (!data || typeof data !== "object") {
    return null;
  }

  const payload = data as DonationAnalyticsDisplayPayload;
  const totals = payload.totals;
  if (!totals || typeof totals !== "object") {
    return null;
  }

  const windowDays =
    typeof payload.window_days === "number" ? payload.window_days : null;
  const lines = [
    `Donation analytics${windowDays ? ` (${windowDays}-day window)` : ""}`,
  ];

  if (typeof totals.successful_donation_count === "number") {
    lines.push(`- Successful donations: ${totals.successful_donation_count}`);
  }
  if (typeof totals.successful_amount_cents === "number") {
    lines.push(`- Raised: $${(totals.successful_amount_cents / 100).toFixed(0)}`);
  }
  if (typeof totals.average_successful_amount_cents === "number") {
    lines.push(
      `- Average successful donation: $${(totals.average_successful_amount_cents / 100).toFixed(0)}`
    );
  }
  if (typeof totals.largest_successful_amount_cents === "number") {
    lines.push(
      `- Largest successful donation: $${(totals.largest_successful_amount_cents / 100).toFixed(0)}`
    );
  }

  if (totals.status_counts && typeof totals.status_counts === "object") {
    const statusSummary = [
      typeof totals.status_counts.succeeded === "number"
        ? `${totals.status_counts.succeeded} succeeded`
        : null,
      typeof totals.status_counts.pending === "number"
        ? `${totals.status_counts.pending} pending`
        : null,
      typeof totals.status_counts.failed === "number"
        ? `${totals.status_counts.failed} failed`
        : null,
    ].filter((value): value is string => Boolean(value));

    if (statusSummary.length > 0) {
      lines.push(`- Status mix: ${statusSummary.join(" - ")}`);
    }
  }

  const latestSuccessfulDonationAt = formatIsoDate(totals.latest_successful_donation_at);
  if (latestSuccessfulDonationAt) {
    lines.push(`- Latest successful donation: ${latestSuccessfulDonationAt}`);
  }

  const topPurposes = Array.isArray(payload.top_purposes)
    ? payload.top_purposes
        .map((row) => {
          if (!row || typeof row !== "object") return null;
          const purpose = getNonEmptyString((row as { purpose?: unknown }).purpose);
          if (!purpose) return null;

          const parts = [
            typeof (row as { donation_count?: unknown }).donation_count === "number"
              ? `${(row as { donation_count: number }).donation_count} donations`
              : null,
            typeof (row as { amount_cents?: unknown }).amount_cents === "number"
              ? `$${(((row as { amount_cents: number }).amount_cents) / 100).toFixed(0)}`
              : null,
          ].filter((value): value is string => Boolean(value));

          return `- ${purpose}${parts.length > 0 ? ` - ${parts.join(" - ")}` : ""}`;
        })
        .filter((row): row is string => Boolean(row))
        .slice(0, 5)
    : [];

  if (topPurposes.length > 0) {
    lines.push("Top purposes");
    lines.push(...topPurposes);
  }

  const trendRows = Array.isArray(payload.trend)
    ? payload.trend
        .map((row) => {
          if (!row || typeof row !== "object") return null;
          const label = getNonEmptyString((row as { bucket_label?: unknown }).bucket_label);
          if (!label) return null;

          const parts = [
            typeof (row as { donation_count?: unknown }).donation_count === "number"
              ? `${(row as { donation_count: number }).donation_count} donations`
              : null,
            typeof (row as { amount_cents?: unknown }).amount_cents === "number"
              ? `$${(((row as { amount_cents: number }).amount_cents) / 100).toFixed(0)}`
              : null,
          ].filter((value): value is string => Boolean(value));

          return `- ${label}${parts.length > 0 ? ` - ${parts.join(" - ")}` : ""}`;
        })
        .filter((row): row is string => Boolean(row))
        .slice(0, 8)
    : [];

  if (trendRows.length > 0) {
    lines.push("Trend");
    lines.push(...trendRows);
  }

  return lines.length > 1 ? lines.join("\n") : null;
}

export function formatListAvailableMentorsResponse(data: unknown): string | null {
  if (!data || typeof data !== "object") return null;

  const payload = data as ListAvailableMentorsDisplayPayload;
  const state = getNonEmptyString(payload.state);
  if (!state) return null;

  if (state === "no_results") {
    return "There are no mentors currently available for new mentees right now.";
  }

  if (state !== "resolved" || !Array.isArray(payload.mentors)) return null;

  const totalAvailable =
    typeof payload.total_available === "number" ? payload.total_available : null;

  const mentors = (payload.mentors as ListAvailableMentorsDisplayRow[])
    .map((row) => {
      const name = getNonEmptyString(row.mentor?.name);
      if (!name) return null;

      const subtitle = getNonEmptyString(row.mentor?.subtitle);
      const displayLine = subtitle ? `${name} — ${subtitle}` : name;
      const openSlots =
        typeof row.open_slots === "number" && typeof row.max_mentees === "number"
          ? `${row.open_slots} open spot${row.open_slots === 1 ? "" : "s"}`
          : null;
      const sports = Array.isArray(row.sports)
        ? row.sports
            .map((value) => getNonEmptyString(value))
            .filter((value): value is string => Boolean(value))
        : [];
      const positions = Array.isArray(row.positions)
        ? row.positions
            .map((value) => getNonEmptyString(value))
            .filter((value): value is string => Boolean(value))
        : [];
      const details = [
        openSlots,
        sports.length > 0 ? `Sports: ${sports.join(", ")}` : null,
        positions.length > 0 ? `Positions: ${positions.join(", ")}` : null,
      ].filter((value): value is string => Boolean(value));

      return { displayLine, details };
    })
    .filter(
      (mentor): mentor is { displayLine: string; details: string[] } => Boolean(mentor)
    )
    .slice(0, 5);

  if (mentors.length === 0) return null;

  const headline =
    totalAvailable && totalAvailable > mentors.length
      ? `There are ${totalAvailable} mentors currently available. Here are the top matches by open capacity:`
      : `There are ${totalAvailable ?? mentors.length} mentors currently available:`;
  const lines = [headline];
  for (const [index, mentor] of mentors.entries()) {
    lines.push(`${index + 1}. ${mentor.displayLine}`);
    if (mentor.details.length > 0) {
      lines.push(`   ${mentor.details.join(" • ")}`);
    }
  }

  return lines.join("\n");
}

export function formatAnnouncementsResponse(data: unknown): string | null {
  if (!Array.isArray(data)) {
    return null;
  }

  if (data.length === 0) {
    return "I couldn't find any recent announcements for this organization.";
  }

  const rows = data
    .map((row) => {
      if (!row || typeof row !== "object") {
        return null;
      }

      const announcement = row as AnnouncementDisplayRow;
      const title = getNonEmptyString(announcement.title);
      if (!title) {
        return null;
      }

      const metadata: string[] = [];
      const publishedAt = getNonEmptyString(announcement.published_at);
      if (publishedAt) {
        metadata.push(publishedAt.slice(0, 10));
      }

      const audience = getNonEmptyString(announcement.audience);
      if (audience) {
        metadata.push(`audience: ${audience.replace(/_/g, " ")}`);
      }

      if (announcement.is_pinned === true) {
        metadata.push("pinned");
      }

      const preview = getNonEmptyString(announcement.body_preview);
      return {
        title,
        metadata,
        preview,
      };
    })
    .filter(
      (
        row
      ): row is {
        title: string;
        metadata: string[];
        preview: string | null;
      } => Boolean(row)
    )
    .slice(0, 5);

  if (rows.length === 0) {
    return null;
  }

  const lines = ["Recent announcements"];
  for (const row of rows) {
    lines.push(`- ${row.title}${row.metadata.length > 0 ? ` - ${row.metadata.join(" - ")}` : ""}`);
    if (row.preview) {
      lines.push(`  Preview: ${row.preview}`);
    }
  }

  return lines.join("\n");
}

export function formatEventsResponse(data: unknown): string | null {
  if (!Array.isArray(data)) {
    return null;
  }

  if (data.length === 0) {
    return "I couldn't find any matching events for this organization.";
  }

  const rows = data
    .map((row) => {
      if (!row || typeof row !== "object") {
        return null;
      }

      const title = getNonEmptyString((row as { title?: unknown }).title);
      if (!title) {
        return null;
      }

      const metadata = [
        formatIsoDate((row as { start_date?: unknown }).start_date),
        getNonEmptyString((row as { location?: unknown }).location),
      ].filter((value): value is string => Boolean(value));
      const description = getNonEmptyString((row as { description?: unknown }).description);

      return { title, metadata, description };
    })
    .filter(
      (
        row
      ): row is {
        title: string;
        metadata: string[];
        description: string | null;
      } => Boolean(row)
    )
    .slice(0, 5);

  if (rows.length === 0) {
    return null;
  }

  const lines = ["Matching events"];
  for (const row of rows) {
    lines.push(`- ${row.title}${row.metadata.length > 0 ? ` - ${row.metadata.join(" - ")}` : ""}`);
    if (row.description) {
      lines.push(`  Details: ${row.description}`);
    }
  }

  return lines.join("\n");
}

export function formatDiscussionsResponse(data: unknown): string | null {
  if (!Array.isArray(data)) {
    return null;
  }

  if (data.length === 0) {
    return "I couldn't find any recent discussion threads for this organization.";
  }

  const rows = data
    .map((row) => {
      if (!row || typeof row !== "object") {
        return null;
      }

      const title = getNonEmptyString((row as { title?: unknown }).title);
      if (!title) {
        return null;
      }

      const metadata = [
        formatIsoDate((row as { created_at?: unknown }).created_at),
        typeof (row as { comment_count?: unknown }).comment_count === "number"
          ? `${(row as { comment_count: number }).comment_count} comments`
          : null,
      ].filter((value): value is string => Boolean(value));
      const preview = getNonEmptyString((row as { body_preview?: unknown }).body_preview);

      return { title, metadata, preview };
    })
    .filter(
      (
        row
      ): row is {
        title: string;
        metadata: string[];
        preview: string | null;
      } => Boolean(row)
    )
    .slice(0, 5);

  if (rows.length === 0) {
    return null;
  }

  const lines = ["Recent discussions"];
  for (const row of rows) {
    lines.push(`- ${row.title}${row.metadata.length > 0 ? ` - ${row.metadata.join(" - ")}` : ""}`);
    if (row.preview) {
      lines.push(`  Preview: ${row.preview}`);
    }
  }

  return lines.join("\n");
}

export function formatJobPostingsResponse(data: unknown): string | null {
  if (!Array.isArray(data)) {
    return null;
  }

  if (data.length === 0) {
    return "I couldn't find any active job postings for this organization.";
  }

  const rows = data
    .map((row) => {
      if (!row || typeof row !== "object") {
        return null;
      }

      const title = getNonEmptyString((row as { title?: unknown }).title);
      if (!title) {
        return null;
      }

      const metadata = [
        getNonEmptyString((row as { company?: unknown }).company),
        getNonEmptyString((row as { location?: unknown }).location),
        getNonEmptyString((row as { location_type?: unknown }).location_type),
      ].filter((value): value is string => Boolean(value));
      const preview = getNonEmptyString(
        (row as { description_preview?: unknown }).description_preview
      );

      return { title, metadata, preview };
    })
    .filter(
      (
        row
      ): row is {
        title: string;
        metadata: string[];
        preview: string | null;
      } => Boolean(row)
    )
    .slice(0, 5);

  if (rows.length === 0) {
    return null;
  }

  const lines = ["Active job postings"];
  for (const row of rows) {
    lines.push(`- ${row.title}${row.metadata.length > 0 ? ` - ${row.metadata.join(" - ")}` : ""}`);
    if (row.preview) {
      lines.push(`  Preview: ${row.preview}`);
    }
  }

  return lines.join("\n");
}

export function formatOrgStatsResponse(data: unknown): string | null {
  if (!data || typeof data !== "object") {
    return null;
  }

  const payload = data as {
    active_members?: unknown;
    alumni?: unknown;
    parents?: unknown;
    upcoming_events?: unknown;
    donations?: {
      total_amount_cents?: unknown;
      donation_count?: unknown;
      last_donation_at?: unknown;
    } | null;
  };

  const lines = ["Organization snapshot"];

  if (typeof payload.active_members === "number") {
    lines.push(`- Active members: ${payload.active_members}`);
  }
  if (typeof payload.alumni === "number") {
    lines.push(`- Alumni: ${payload.alumni}`);
  }
  if (typeof payload.parents === "number") {
    lines.push(`- Parents: ${payload.parents}`);
  }
  if (typeof payload.upcoming_events === "number") {
    lines.push(`- Upcoming events: ${payload.upcoming_events}`);
  }

  if (payload.donations && typeof payload.donations === "object") {
    const donationSummary: string[] = [];
    if (typeof payload.donations.donation_count === "number") {
      donationSummary.push(`${payload.donations.donation_count} donations`);
    }
    if (typeof payload.donations.total_amount_cents === "number") {
      donationSummary.push(`$${(payload.donations.total_amount_cents / 100).toFixed(0)} raised`);
    }
    const lastDonationDate = formatIsoDate(payload.donations.last_donation_at);
    if (lastDonationDate) {
      donationSummary.push(`last donation ${lastDonationDate}`);
    }

    if (donationSummary.length > 0) {
      lines.push(`- Donations: ${donationSummary.join(" - ")}`);
    }
  }

  return lines.length > 1 ? lines.join("\n") : null;
}

function formatMemberRole(value: unknown): string | null {
  const role = getNonEmptyString(value);
  if (!role) {
    return null;
  }

  switch (role) {
    case "admin":
      return "Admin";
    case "active_member":
      return "Active Member";
    case "alumni":
      return "Alumni";
    case "parent":
      return "Parent";
    default:
      return role
        .split(/[_\s]+/)
        .filter(Boolean)
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(" ");
  }
}

export function formatMembersResponse(data: unknown): string | null {
  if (!Array.isArray(data)) {
    return null;
  }

  if (data.length === 0) {
    return "I couldn't find any active members for this organization.";
  }

  const rows = data
    .map((row) => {
      if (!row || typeof row !== "object") {
        return null;
      }

      const email = getNonEmptyString((row as { email?: unknown }).email);
      const roleLabel = formatMemberRole((row as { role?: unknown }).role);
      const addedDate = formatIsoDate((row as { created_at?: unknown }).created_at);
      const name = getNonEmptyString((row as { name?: unknown }).name);

      const label = name
        ? `${name}${roleLabel ? ` (${roleLabel})` : ""}`
        : email
          ? roleLabel === "Admin"
            ? "Email-only admin account"
            : "Email-only member account"
          : null;

      if (!label) {
        return null;
      }

      const metadata = [email, addedDate ? `added ${addedDate}` : null].filter(
        (value): value is string => Boolean(value)
      );

      return `- ${label}${metadata.length > 0 ? ` - ${metadata.join(" - ")}` : ""}`;
    })
    .filter((row): row is string => Boolean(row))
    .slice(0, 5);

  if (rows.length === 0) {
    return null;
  }

  return ["Recent active members", ...rows].join("\n");
}

export function formatAlumniResponse(data: unknown): string | null {
  if (!Array.isArray(data)) {
    return null;
  }

  if (data.length === 0) {
    return "I couldn't find any alumni for this organization.";
  }

  const rows = data
    .map((row) => {
      if (!row || typeof row !== "object") {
        return null;
      }

      const name = getNonEmptyString((row as { name?: unknown }).name);
      if (!name) {
        return null;
      }

      const gradYear = typeof (row as { graduation_year?: unknown }).graduation_year === "number"
        ? `class of ${(row as { graduation_year: number }).graduation_year}`
        : null;
      const company = getNonEmptyString((row as { current_company?: unknown }).current_company);
      const city = getNonEmptyString((row as { current_city?: unknown }).current_city);
      const title = getNonEmptyString((row as { title?: unknown }).title);

      const metadata = [gradYear, company, city].filter(
        (value): value is string => Boolean(value)
      );
      const suffix = title ? ` (${title})` : "";

      return `- ${name}${metadata.length > 0 ? ` - ${metadata.join(" - ")}` : ""}${suffix}`;
    })
    .filter((row): row is string => Boolean(row))
    .slice(0, 10);

  if (rows.length === 0) {
    return null;
  }

  return ["Alumni", ...rows].join("\n");
}

export function formatEnterpriseAlumniResponse(data: unknown): string | null {
  if (!data || typeof data !== "object") {
    return null;
  }

  const payload = data as {
    results?: unknown;
    total?: unknown;
  };

  if (!Array.isArray(payload.results)) {
    return null;
  }

  if (payload.results.length === 0) {
    return "I couldn't find any matching alumni across the enterprise.";
  }

  const rows = payload.results
    .map((row) => {
      if (!row || typeof row !== "object") {
        return null;
      }

      const name = getNonEmptyString((row as { name?: unknown }).name);
      if (!name) {
        return null;
      }

      const organizationName = getNonEmptyString(
        (row as { organization_name?: unknown }).organization_name,
      );
      const gradYear =
        typeof (row as { graduation_year?: unknown }).graduation_year === "number"
          ? `class of ${(row as { graduation_year: number }).graduation_year}`
          : null;
      const company = getNonEmptyString((row as { current_company?: unknown }).current_company);
      const city = getNonEmptyString((row as { current_city?: unknown }).current_city);
      const title = getNonEmptyString((row as { title?: unknown }).title);

      const metadata = [
        organizationName,
        gradYear,
        company,
        city,
      ].filter((value): value is string => Boolean(value));

      return `- ${name}${metadata.length > 0 ? ` - ${metadata.join(" - ")}` : ""}${title ? ` (${title})` : ""}`;
    })
    .filter((row): row is string => Boolean(row))
    .slice(0, 10);

  if (rows.length === 0) {
    return null;
  }

  const total =
    typeof payload.total === "number" ? ` (${payload.total} total)` : "";

  return [`Enterprise alumni${total}`, ...rows].join("\n");
}

export function formatEnterpriseStatsResponse(data: unknown): string | null {
  if (!data || typeof data !== "object") {
    return null;
  }

  const payload = data as {
    total_count?: unknown;
    org_stats?: unknown;
    top_industries?: unknown;
  };

  const lines = ["Enterprise alumni snapshot"];

  if (typeof payload.total_count === "number") {
    lines.push(`- Total alumni: ${payload.total_count}`);
  }

  if (Array.isArray(payload.org_stats) && payload.org_stats.length > 0) {
    const orgSummary = payload.org_stats
      .map((row) => {
        if (!row || typeof row !== "object") {
          return null;
        }
        const name = getNonEmptyString((row as { name?: unknown }).name);
        const count =
          typeof (row as { count?: unknown }).count === "number"
            ? (row as { count: number }).count
            : null;
        if (!name || count == null) {
          return null;
        }
        return `${name} (${count})`;
      })
      .filter((value): value is string => Boolean(value))
      .slice(0, 5);

    if (orgSummary.length > 0) {
      lines.push(`- Org counts: ${orgSummary.join(", ")}`);
    }
  }

  if (Array.isArray(payload.top_industries) && payload.top_industries.length > 0) {
    const industries = payload.top_industries
      .map((row) => {
        if (!row || typeof row !== "object") {
          return null;
        }
        const name = getNonEmptyString((row as { name?: unknown }).name);
        const count =
          typeof (row as { count?: unknown }).count === "number"
            ? (row as { count: number }).count
            : null;
        if (!name || count == null) {
          return null;
        }
        return `${name} (${count})`;
      })
      .filter((value): value is string => Boolean(value))
      .slice(0, 5);

    if (industries.length > 0) {
      lines.push(`- Top industries: ${industries.join(", ")}`);
    }
  }

  return lines.length > 1 ? lines.join("\n") : null;
}

export function formatEnterpriseQuotaResponse(data: unknown): string | null {
  if (!data || typeof data !== "object") {
    return null;
  }

  const payload = data as {
    alumni?: { used?: unknown; limit?: unknown; remaining?: unknown } | null;
    sub_orgs?: {
      total?: unknown;
      enterprise_managed_total?: unknown;
      free_limit?: unknown;
      free_remaining?: unknown;
      configured_limit?: unknown;
      configured_remaining?: unknown;
    } | null;
  };

  const lines = ["Enterprise quota"];

  if (payload.alumni && typeof payload.alumni === "object") {
    const used =
      typeof payload.alumni.used === "number" ? payload.alumni.used : null;
    const limit =
      typeof payload.alumni.limit === "number" ? payload.alumni.limit : null;
    const remaining =
      typeof payload.alumni.remaining === "number" ? payload.alumni.remaining : null;

    if (used != null && limit != null) {
      lines.push(`- Alumni seats: ${used}/${limit} used`);
    }
    if (remaining != null) {
      lines.push(`- Alumni seats remaining: ${remaining}`);
    }
  }

  if (payload.sub_orgs && typeof payload.sub_orgs === "object") {
    const total =
      typeof payload.sub_orgs.total === "number" ? payload.sub_orgs.total : null;
    const enterpriseManagedTotal =
      typeof payload.sub_orgs.enterprise_managed_total === "number"
        ? payload.sub_orgs.enterprise_managed_total
        : null;
    const freeLimit =
      typeof payload.sub_orgs.free_limit === "number" ? payload.sub_orgs.free_limit : null;
    const freeRemaining =
      typeof payload.sub_orgs.free_remaining === "number"
        ? payload.sub_orgs.free_remaining
        : null;
    const configuredLimit =
      typeof payload.sub_orgs.configured_limit === "number"
        ? payload.sub_orgs.configured_limit
        : null;
    const configuredRemaining =
      typeof payload.sub_orgs.configured_remaining === "number"
        ? payload.sub_orgs.configured_remaining
        : null;

    if (total != null) {
      lines.push(`- Managed orgs: ${total}`);
    }
    if (enterpriseManagedTotal != null) {
      lines.push(`- Enterprise-managed org seats in use: ${enterpriseManagedTotal}`);
    }
    if (freeLimit != null) {
      lines.push(`- Free sub-org slots included: ${freeLimit}`);
    }
    if (freeRemaining != null) {
      lines.push(`- Free sub-org slots remaining: ${freeRemaining}`);
    }
    if (configuredLimit != null) {
      lines.push(`- Configured sub-org seat limit: ${configuredLimit}`);
    }
    if (configuredRemaining != null) {
      lines.push(`- Configured sub-org seats remaining: ${configuredRemaining}`);
    }
  }

  return lines.length > 1 ? lines.join("\n") : null;
}

export function formatEnterpriseOrgCapacityResponse(data: unknown): string | null {
  if (!data || typeof data !== "object") {
    return null;
  }

  const payload = data as {
    sub_orgs?: {
      total?: unknown;
      enterprise_managed_total?: unknown;
      free_limit?: unknown;
      free_remaining?: unknown;
    } | null;
  };

  if (!payload.sub_orgs || typeof payload.sub_orgs !== "object") {
    return null;
  }

  const total =
    typeof payload.sub_orgs.total === "number" ? payload.sub_orgs.total : null;
  const enterpriseManagedTotal =
    typeof payload.sub_orgs.enterprise_managed_total === "number"
      ? payload.sub_orgs.enterprise_managed_total
      : null;
  const freeLimit =
    typeof payload.sub_orgs.free_limit === "number" ? payload.sub_orgs.free_limit : null;
  const freeRemaining =
    typeof payload.sub_orgs.free_remaining === "number"
      ? payload.sub_orgs.free_remaining
      : null;

  const lines = ["Enterprise managed-org capacity"];
  if (total != null) {
    lines.push(`- Managed orgs: ${total}`);
  }
  if (enterpriseManagedTotal != null) {
    lines.push(`- Enterprise-managed org seats in use: ${enterpriseManagedTotal}`);
  }
  if (freeLimit != null) {
    lines.push(`- Free sub-org slots included: ${freeLimit}`);
  }
  if (freeRemaining != null) {
    lines.push(`- Free sub-org slots remaining: ${freeRemaining}`);
  }

  return lines.length > 1 ? lines.join("\n") : null;
}

export function formatManagedOrgsResponse(data: unknown): string | null {
  if (!data || typeof data !== "object") {
    return null;
  }

  const payload = data as { organizations?: unknown; total?: unknown };
  if (!Array.isArray(payload.organizations)) {
    return null;
  }

  if (payload.organizations.length === 0) {
    return "I couldn't find any organizations managed by this enterprise.";
  }

  const rows = payload.organizations
    .map((row) => {
      if (!row || typeof row !== "object") {
        return null;
      }

      const name = getNonEmptyString((row as { name?: unknown }).name);
      if (!name) {
        return null;
      }

      const slug = getNonEmptyString((row as { slug?: unknown }).slug);
      const relationshipType = getNonEmptyString(
        (row as { enterprise_relationship_type?: unknown }).enterprise_relationship_type,
      );
      const adoptedAt = formatIsoDate(
        (row as { enterprise_adopted_at?: unknown }).enterprise_adopted_at,
      );

      const metadata = [slug, relationshipType, adoptedAt].filter(
        (value): value is string => Boolean(value),
      );

      return `- ${name}${metadata.length > 0 ? ` - ${metadata.join(" - ")}` : ""}`;
    })
    .filter((row): row is string => Boolean(row))
    .slice(0, 10);

  if (rows.length === 0) {
    return null;
  }

  const total =
    typeof payload.total === "number" ? ` (${payload.total} total)` : "";

  return [`Managed organizations${total}`, ...rows].join("\n");
}

export function formatAuditEventsResponse(data: unknown): string | null {
  if (!data || typeof data !== "object") {
    return null;
  }

  const payload = data as { events?: unknown; total?: unknown };
  if (!Array.isArray(payload.events)) {
    return null;
  }

  if (payload.events.length === 0) {
    return "I couldn't find any recent enterprise audit events.";
  }

  const rows = payload.events
    .map((row) => {
      if (!row || typeof row !== "object") {
        return null;
      }

      const source = getNonEmptyString((row as { source?: unknown }).source);
      const action = getNonEmptyString((row as { action?: unknown }).action);
      const when = formatIsoDate((row as { created_at?: unknown }).created_at);
      const actor = getNonEmptyString(
        (row as { actor_email_redacted?: unknown }).actor_email_redacted,
      );
      const targetType = getNonEmptyString((row as { target_type?: unknown }).target_type);
      const status = getNonEmptyString((row as { status?: unknown }).status);

      const parts = [action ?? source ?? "event"];
      if (when) parts.push(when);
      if (actor) parts.push(`by ${actor}`);
      if (targetType) parts.push(`target: ${targetType}`);
      if (status) parts.push(`status: ${status}`);

      return `- ${parts.join(" - ")}`;
    })
    .filter((row): row is string => Boolean(row))
    .slice(0, 25);

  if (rows.length === 0) {
    return null;
  }

  const total =
    typeof payload.total === "number" ? ` (${payload.total} total)` : "";

  return [`Recent enterprise audit events${total}`, ...rows].join("\n");
}

export function formatDonationsResponse(
  data: unknown,
  options?: DonationResponseOptions,
): string | null {
  if (!Array.isArray(data)) {
    return null;
  }

  if (data.length === 0) {
    return "I couldn't find any donations for this organization.";
  }

  const rows = data
    .map((row) => {
      if (!row || typeof row !== "object") {
        return null;
      }

      const donorName = options?.hideDonorNames
        ? "Anonymous donor"
        : (getNonEmptyString((row as { donor_name?: unknown }).donor_name) ?? "Unknown");
      const amountDollars = typeof (row as { amount_dollars?: unknown }).amount_dollars === "number"
        ? `$${((row as { amount_dollars: number }).amount_dollars).toFixed(2)}`
        : null;
      const status = getNonEmptyString((row as { status?: unknown }).status);
      const date = formatIsoDate((row as { created_at?: unknown }).created_at);
      const purpose = getNonEmptyString((row as { purpose?: unknown }).purpose);

      const metadata = [amountDollars, status, date].filter(
        (value): value is string => Boolean(value)
      );
      const suffix = purpose ? ` (${purpose})` : "";

      return `- ${donorName}${metadata.length > 0 ? ` - ${metadata.join(" - ")}` : ""}${suffix}`;
    })
    .filter((row): row is string => Boolean(row))
    .slice(0, 10);

  if (rows.length === 0) {
    return null;
  }

  return ["Donations", ...rows].join("\n");
}

export function formatParentsResponse(data: unknown): string | null {
  if (!Array.isArray(data)) {
    return null;
  }

  if (data.length === 0) {
    return "I couldn't find any parents for this organization.";
  }

  const rows = data
    .map((row) => {
      if (!row || typeof row !== "object") {
        return null;
      }

      const name = getNonEmptyString((row as { name?: unknown }).name);
      if (!name) {
        return null;
      }

      const relationship = getNonEmptyString((row as { relationship?: unknown }).relationship);
      const studentName = getNonEmptyString((row as { student_name?: unknown }).student_name);

      const metadata = [
        relationship,
        studentName ? `student: ${studentName}` : null,
      ].filter((value): value is string => Boolean(value));

      return `- ${name}${metadata.length > 0 ? ` - ${metadata.join(" - ")}` : ""}`;
    })
    .filter((row): row is string => Boolean(row))
    .slice(0, 10);

  if (rows.length === 0) {
    return null;
  }

  return ["Parent directory", ...rows].join("\n");
}

export function formatPhilanthropyEventsResponse(data: unknown): string | null {
  if (!Array.isArray(data)) {
    return null;
  }

  if (data.length === 0) {
    return "I couldn't find any philanthropy events for this organization.";
  }

  const rows = data
    .map((row) => {
      if (!row || typeof row !== "object") {
        return null;
      }

      const title = getNonEmptyString((row as { title?: unknown }).title);
      if (!title) {
        return null;
      }

      const metadata = [
        formatIsoDate((row as { start_date?: unknown }).start_date),
        getNonEmptyString((row as { location?: unknown }).location),
      ].filter((value): value is string => Boolean(value));
      const description = getNonEmptyString((row as { description?: unknown }).description);

      return { title, metadata, description };
    })
    .filter(
      (
        row
      ): row is {
        title: string;
        metadata: string[];
        description: string | null;
      } => Boolean(row)
    )
    .slice(0, 5);

  if (rows.length === 0) {
    return null;
  }

  const lines = ["Philanthropy events"];
  for (const row of rows) {
    lines.push(`- ${row.title}${row.metadata.length > 0 ? ` - ${row.metadata.join(" - ")}` : ""}`);
    if (row.description) {
      lines.push(`  Details: ${row.description}`);
    }
  }

  return lines.join("\n");
}

export function formatChatGroupsResponse(data: unknown): string | null {
  if (!Array.isArray(data)) {
    return null;
  }

  const groups = data
    .map((row) => {
      if (!row || typeof row !== "object") {
        return null;
      }

      const name = getNonEmptyString((row as { name?: unknown }).name);
      if (!name) {
        return null;
      }

      const role = getNonEmptyString((row as { role?: unknown }).role);
      return role ? `${name} (${role})` : name;
    })
    .filter((row): row is string => Boolean(row))
    .slice(0, 8);

  if (groups.length === 0) {
    return "You do not have any active chat groups available right now.";
  }

  return `You can message these chat groups:\n- ${groups.join("\n- ")}`;
}

export function formatNavigationTargetsResponse(data: unknown): string | null {
  if (!data || typeof data !== "object") {
    return null;
  }

  const payload = data as NavigationDisplayPayload;
  const state = getNonEmptyString(payload.state);
  const query = getNonEmptyString(payload.query) ?? "that";

  if (!state) {
    return null;
  }

  if (state === "not_found") {
    return `I couldn't find a matching page for "${query}". Try naming the feature, like announcements, members, events, donations, or navigation settings.`;
  }

  if (state !== "resolved" || !Array.isArray(payload.matches)) {
    return null;
  }

  const matches = payload.matches
    .map((row) => {
      if (!row || typeof row !== "object") {
        return null;
      }

      const target = row as NavigationDisplayTarget;
      const label = getNonEmptyString(target.label);
      const href = getNonEmptyString(target.href);
      if (!label || !href) {
        return null;
      }

      const description = getNonEmptyString(target.description);
      const kind = getNonEmptyString(target.kind);
      const manualSteps = Array.isArray(target.manualSteps)
        ? target.manualSteps.map(getNonEmptyString).filter((value): value is string => Boolean(value))
        : [];
      const assistantCanHelpWith = Array.isArray(target.assistantCanHelpWith)
        ? target.assistantCanHelpWith.map(getNonEmptyString).filter((value): value is string => Boolean(value))
        : [];
      const userCanAccess =
        typeof target.userCanAccess === "boolean" ? target.userCanAccess : true;
      return { label, href, description, kind, manualSteps, assistantCanHelpWith, userCanAccess };
    })
    .filter(
      (
        row
      ): row is {
        label: string;
        href: string;
        description: string | null;
        kind: string | null;
        manualSteps: string[];
        assistantCanHelpWith: string[];
        userCanAccess: boolean;
      } => Boolean(row)
    )
    .filter((row) => row.userCanAccess)
    .slice(0, 3);

  if (matches.length === 0) {
    return null;
  }

  const escapeLabel = (label: string) => label.replace(/_/g, "\\_");

  const blocks: string[] = [];
  if (matches.length > 1) {
    blocks.push(`Best matches for "${query}":`);
  }
  for (const match of matches) {
    const header =
      matches.length === 1
        ? `[${escapeLabel(match.label)}](${match.href})`
        : `- [${escapeLabel(match.label)}](${match.href})`;
    const lines: string[] = [header];
    const manualStep = match.manualSteps[0];
    if (manualStep) {
      lines.push(`Next: ${manualStep}`);
    }
    const assistantHelp = match.assistantCanHelpWith[0];
    if (assistantHelp) {
      lines.push(`I can help: ${assistantHelp}`);
    }
    blocks.push(lines.join("  \n"));
  }

  return blocks.join("\n\n");
}
