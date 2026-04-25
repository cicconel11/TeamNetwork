// Per-tool grounding coverage checks. Each verify*<Tool> consumes the model's
// rendered content + the matching tool's structured data and returns a list of
// failure strings (empty = grounded).

import {
  contentIsGroundingFallback,
  extractAllCurrencyDollars,
  extractEmails,
  extractListEntryHeads,
  extractMentionedDates,
  extractQuotedTitles,
  normalizeIdentifier,
  parseCurrencyClaim,
  stripMarkdown,
} from "@/lib/ai/grounding-primitives";
import {
  extractMentorReasonCodes,
  extractSuggestConnectionReasonCodes,
  type DonationAnalyticsVerifyPayload,
  type ListDonationsRow,
  type StatRow,
  type SuggestConnectionGroundingData,
  type SuggestConnectionGroundingRow,
  type SuggestMentorsGroundingData,
} from "./claim-extraction";

export interface ListDonationsGroundingContext {
  hideDonorNames?: boolean;
}

function normalizeMemberCandidate(value: string): string {
  // Strip trailing parenthetical decorations the model adds from RAG context
  // (positions, titles, roles) so the lookup matches the bare name in
  // list_members rows. Examples: "JT Goodman (Running Back)",
  // "Louis Ciccone (Chairman and CEO)", "Sam Smith (active member)".
  return normalizeIdentifier(
    stripMarkdown(value)
      .replace(/\s+\([^)]*\)\s*$/i, "")
      .replace(/^(?:name|member)\s*:\s*/i, "")
      .trim()
  );
}

function isIgnoredMemberCandidate(value: string): boolean {
  return /^(?:email|role|added|joined|status|member type|type)$/i.test(value.trim());
}

function parseStatClaim(content: string, label: string): number | null {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  for (const rawLine of content.split("\n")) {
    const line = rawLine.trim();
    if (!new RegExp(`\\b${escaped}\\b`, "i").test(line)) {
      continue;
    }

    const numberFirst = line.match(
      new RegExp(`\\b(\\d+)\\b[^a-zA-Z]{0,10}\\b${escaped}\\b`, "i")
    );
    if (numberFirst) {
      return Number(numberFirst[1]);
    }

    const labelFirst = line.match(
      new RegExp(`\\b${escaped}\\b[^0-9]*(\\d+)`, "i")
    );
    if (labelFirst) {
      return Number(labelFirst[1]);
    }
  }

  return null;
}

function collectStatRows(
  value: unknown,
  labelField: "bucket_label" | "purpose",
): Map<string, StatRow> {
  const map = new Map<string, StatRow>();
  if (!Array.isArray(value)) return map;
  for (const row of value) {
    if (!row || typeof row !== "object") continue;
    const label = (row as Record<string, unknown>)[labelField];
    const cents = (row as { amount_cents?: unknown }).amount_cents;
    const donationCount = (row as { donation_count?: unknown }).donation_count;
    if (
      typeof label !== "string" ||
      typeof cents !== "number" ||
      typeof donationCount !== "number"
    ) {
      continue;
    }
    map.set(normalizeIdentifier(label), {
      label,
      amount_cents: cents,
      donation_count: donationCount,
    });
  }
  return map;
}

// Formatter row shape: `- <label> - <N> donations - $<amount>`.
// Matches both trend rows and top-purpose rows. Returns null when line is not
// a formatter row.
function parseFormatterStatsRow(
  line: string
): { label: string; donationCount: number; amountDollars: number } | null {
  const stripped = line.replace(/^([-*]|\d+\.)\s+/, "").trim();
  const match = stripped.match(
    /^(.+?)\s*-\s*(\d+)\s+donations?\s*-\s*\$([0-9][0-9,]*(?:\.[0-9]{1,2})?)(k|K)?\b/i
  );
  if (!match) return null;
  const amount = Number.parseFloat(match[3].replace(/,/g, ""));
  if (!Number.isFinite(amount)) return null;
  const scaled = match[4] ? amount * 1000 : amount;
  return {
    label: match[1].trim(),
    donationCount: Number(match[2]),
    amountDollars: Math.round(scaled),
  };
}

const DONATION_ANALYTICS_CANONICAL_LABELS = [
  "donation analytics",
  "successful donations",
  "raised",
  "average successful donation",
  "largest successful donation",
  "trend",
  "top purposes",
  "status mix",
  "latest successful donation",
];

function answerStatesListIsPartial(content: string): boolean {
  return /\b(partial|showing|first|latest|recent|top)\b/i.test(content);
}

function formatKnownEventDates(startDate: string): string[] {
  const isoDate = startDate.slice(0, 10);
  const parsed = new Date(startDate);
  if (Number.isNaN(parsed.getTime())) {
    return [isoDate];
  }

  return [
    isoDate,
    parsed.toLocaleDateString("en-US", {
      timeZone: "UTC",
      year: "numeric",
      month: "long",
      day: "numeric",
    }).toLowerCase(),
  ];
}

export function verifyOrgStats(content: string, data: unknown): string[] {
  if (!data || typeof data !== "object") {
    return ["get_org_stats returned non-object data"];
  }

  const stats = data as Partial<Record<string, unknown>>;
  const activeMembers = Number(stats.active_members);
  const alumni = Number(stats.alumni);
  const parents = Number(stats.parents);
  const total = activeMembers + alumni + parents;
  const failures: string[] = [];

  const claimChecks: Array<[string, number]> = [
    ["active members", activeMembers],
    ["alumni", alumni],
    ["parents", parents],
    ["total", total],
  ];

  for (const [label, expected] of claimChecks) {
    const claimed = parseStatClaim(content, label);
    if (claimed !== null && claimed !== expected) {
      failures.push(`${label} claim ${claimed} did not match ${expected}`);
    }
  }

  return failures;
}

export function verifyDonationAnalytics(content: string, data: unknown): string[] {
  if (!data || typeof data !== "object") {
    return ["get_donation_analytics returned non-object data"];
  }

  const payload = data as DonationAnalyticsVerifyPayload;

  if (!payload.totals || typeof payload.totals !== "object") {
    return ["get_donation_analytics returned missing totals"];
  }

  if (contentIsGroundingFallback(content)) {
    return [];
  }

  const failures: string[] = [];
  const successfulDonationCount = Number(payload.totals.successful_donation_count);
  const raisedDollars = Number(payload.totals.successful_amount_cents) / 100;
  const averageDollars = Number(payload.totals.average_successful_amount_cents) / 100;
  const largestDollars = Number(payload.totals.largest_successful_amount_cents) / 100;

  const lowered = content.toLowerCase();
  const referencesCanonicalLabel = DONATION_ANALYTICS_CANONICAL_LABELS.some((label) =>
    lowered.includes(label)
  );

  const referencesAnyNumber = /\b\d+\b/.test(content) || /\$\d/.test(content);
  if (referencesAnyNumber && !referencesCanonicalLabel) {
    failures.push("donation analytics response did not reference formatter labels");
  }

  const countClaim = parseStatClaim(content, "successful donations");
  if (countClaim !== null && countClaim !== successfulDonationCount) {
    failures.push(
      `successful donations claim ${countClaim} did not match ${successfulDonationCount}`
    );
  }

  const raisedClaim = parseCurrencyClaim(content, "raised");
  if (raisedClaim !== null && raisedClaim !== Math.round(raisedDollars)) {
    failures.push(`raised claim $${raisedClaim} did not match $${Math.round(raisedDollars)}`);
  }

  const averageClaim = parseCurrencyClaim(content, "average successful donation");
  if (averageClaim !== null && averageClaim !== Math.round(averageDollars)) {
    failures.push(
      `average successful donation claim $${averageClaim} did not match $${Math.round(averageDollars)}`
    );
  }

  const largestClaim = parseCurrencyClaim(content, "largest successful donation");
  if (largestClaim !== null && largestClaim !== Math.round(largestDollars)) {
    failures.push(
      `largest successful donation claim $${largestClaim} did not match $${Math.round(largestDollars)}`
    );
  }

  const trendMap = collectStatRows(payload.trend, "bucket_label");
  const purposeMap = collectStatRows(payload.top_purposes, "purpose");

  let inTrendSection = false;
  let inPurposesSection = false;
  for (const rawLine of content.split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;
    const normalizedHeader = line.replace(/[*_`~>#:]/g, "").trim().toLowerCase();
    if (normalizedHeader === "trend") {
      inTrendSection = true;
      inPurposesSection = false;
      continue;
    }
    if (normalizedHeader === "top purposes") {
      inPurposesSection = true;
      inTrendSection = false;
      continue;
    }
    if (!/^([-*]|\d+\.)\s+/.test(line)) continue;

    const parsed = parseFormatterStatsRow(line);
    if (!parsed) continue;

    if (inTrendSection) {
      const key = normalizeIdentifier(parsed.label);
      const row = trendMap.get(key);
      if (!row) {
        failures.push(`trend row ${parsed.label} was not present in tool data`);
        continue;
      }
      const expectedAmount = Math.round(row.amount_cents / 100);
      if (row.donation_count !== parsed.donationCount) {
        failures.push(
          `trend donation count claim ${parsed.donationCount} did not match ${row.donation_count} for ${parsed.label}`
        );
      }
      if (expectedAmount !== parsed.amountDollars) {
        failures.push(
          `trend amount claim $${parsed.amountDollars} did not match $${expectedAmount} for ${parsed.label}`
        );
      }
    } else if (inPurposesSection) {
      const key = normalizeIdentifier(parsed.label);
      const row = purposeMap.get(key);
      if (!row) {
        failures.push(`top purpose ${parsed.label} was not present in tool data`);
        continue;
      }
      const expectedAmount = Math.round(row.amount_cents / 100);
      if (row.donation_count !== parsed.donationCount) {
        failures.push(
          `top purpose donation count claim ${parsed.donationCount} did not match ${row.donation_count} for ${parsed.label}`
        );
      }
      if (expectedAmount !== parsed.amountDollars) {
        failures.push(
          `top purpose amount claim $${parsed.amountDollars} did not match $${expectedAmount} for ${parsed.label}`
        );
      }
    }
  }

  return failures;
}

export function verifyListDonations(
  content: string,
  data: unknown,
  context: ListDonationsGroundingContext | undefined
): string[] {
  if (!Array.isArray(data)) {
    return ["list_donations returned non-array data"];
  }

  if (contentIsGroundingFallback(content)) {
    return [];
  }

  const rows = data as ListDonationsRow[];
  const donorNames = new Set<string>();
  const donorEmails = new Set<string>();
  const amountDollars = new Set<number>();

  for (const row of rows) {
    const name = typeof row.donor_name === "string" ? row.donor_name.trim() : "";
    if (name && name.toLowerCase() !== "anonymous") {
      donorNames.add(normalizeIdentifier(name));
    }
    const email = typeof row.donor_email === "string" ? row.donor_email.trim() : "";
    if (email && email.toLowerCase() !== "anonymous") {
      donorEmails.add(normalizeIdentifier(email));
    }
    if (typeof row.amount_dollars === "number" && Number.isFinite(row.amount_dollars)) {
      amountDollars.add(Math.round(row.amount_dollars));
    }
  }

  const failures: string[] = [];
  const hideDonorNames = context?.hideDonorNames === true;

  const quotedNames = extractQuotedTitles(content);
  for (const quoted of quotedNames) {
    const normalized = normalizeIdentifier(quoted);
    if (hideDonorNames && donorNames.has(normalized)) {
      failures.push(`donor name ${quoted} leaked while hide_donor_names is enabled`);
      continue;
    }
    if (!hideDonorNames && !donorNames.has(normalized)) {
      // Quoted strings that are not donor names may be purposes; accept if
      // they match a purpose.
      const purposes = new Set(
        rows
          .map((row) => (typeof row.purpose === "string" ? normalizeIdentifier(row.purpose) : null))
          .filter((v): v is string => Boolean(v))
      );
      if (!purposes.has(normalized)) {
        failures.push(`donor name ${quoted} was not present in tool rows`);
      }
    }
  }

  for (const email of extractEmails(content)) {
    if (hideDonorNames) {
      failures.push(`donor email ${email} leaked while hide_donor_names is enabled`);
      continue;
    }
    if (!donorEmails.has(normalizeIdentifier(email))) {
      failures.push(`donor email ${email} was not present in tool rows`);
    }
  }

  for (const claimedDollars of extractAllCurrencyDollars(content)) {
    if (claimedDollars === 0) continue;
    if (!amountDollars.has(claimedDollars)) {
      failures.push(`donation amount claim $${claimedDollars} was not present in tool rows`);
    }
  }

  if (hideDonorNames) {
    for (const candidate of extractListEntryHeads(content)) {
      const normalized = normalizeIdentifier(candidate);
      if (donorNames.has(normalized)) {
        failures.push(`donor name ${candidate} leaked while hide_donor_names is enabled`);
      }
    }
  }

  return failures;
}

export function verifyListMembers(content: string, data: unknown): string[] {
  if (!Array.isArray(data)) {
    return ["list_members returned non-array data"];
  }

  const names = new Set(
    data
      .map((row) =>
        row && typeof row === "object" && typeof (row as { name?: unknown }).name === "string"
          ? normalizeIdentifier((row as { name: string }).name)
          : null
      )
      .filter((value): value is string => Boolean(value))
  );
  const emails = new Set(
    data
      .map((row) =>
        row && typeof row === "object" && typeof (row as { email?: unknown }).email === "string"
          ? normalizeIdentifier((row as { email: string }).email)
          : null
      )
      .filter((value): value is string => Boolean(value))
  );

  const failures: string[] = [];
  const countClaim = content.match(/\b(\d+)\s+(?:active\s+)?members?\b/i);
  if (countClaim) {
    const claimed = Number(countClaim[1]);
    if (claimed > data.length && !answerStatesListIsPartial(content)) {
      failures.push(`member count claim ${claimed} exceeded returned rows ${data.length}`);
    }
  }

  for (const email of extractEmails(content)) {
    if (!emails.has(normalizeIdentifier(email))) {
      failures.push(`member email ${email} was not present in tool rows`);
    }
  }

  for (const candidate of extractListEntryHeads(content)) {
    const normalizedCandidate = normalizeMemberCandidate(candidate);
    if (
      isIgnoredMemberCandidate(candidate) ||
      normalizedCandidate.includes("@") ||
      normalizedCandidate.length < 3 ||
      /^your organization/.test(normalizedCandidate)
    ) {
      continue;
    }
    if (!names.has(normalizedCandidate)) {
      failures.push(`member name ${candidate} was not present in tool rows`);
    }
  }

  return failures;
}

export function verifyListEvents(content: string, data: unknown): string[] {
  if (!Array.isArray(data)) {
    return ["list_events returned non-array data"];
  }

  const titles = new Set(
    data
      .map((row) =>
        row && typeof row === "object" && typeof (row as { title?: unknown }).title === "string"
          ? normalizeIdentifier((row as { title: string }).title)
          : null
      )
      .filter((value): value is string => Boolean(value))
  );
  const dates = new Set(
    data.flatMap((row) =>
      row && typeof row === "object" && typeof (row as { start_date?: unknown }).start_date === "string"
        ? formatKnownEventDates((row as { start_date: string }).start_date)
        : []
    )
  );

  const failures: string[] = [];
  for (const title of extractQuotedTitles(content)) {
    if (!titles.has(normalizeIdentifier(title))) {
      failures.push(`event title ${title} was not present in tool rows`);
    }
  }

  for (const date of extractMentionedDates(content)) {
    if (!dates.has(date)) {
      failures.push(`event date ${date} was not present in tool rows`);
    }
  }

  return failures;
}

export function verifyListDiscussions(content: string, data: unknown): string[] {
  if (!Array.isArray(data)) {
    return ["list_discussions returned non-array data"];
  }

  type DiscussionRow = { title?: unknown; reply_count?: unknown };
  const rows = data as DiscussionRow[];

  const titles = new Set(
    rows
      .map((row) =>
        row && typeof row === "object" && typeof row.title === "string"
          ? normalizeIdentifier(row.title)
          : null
      )
      .filter((value): value is string => Boolean(value))
  );

  const replyCountByTitle = new Map(
    rows
      .filter(
        (row) =>
          row &&
          typeof row === "object" &&
          typeof row.title === "string" &&
          typeof row.reply_count === "number"
      )
      .map((row) => [normalizeIdentifier(row.title as string), row.reply_count as number])
  );

  const titleList = [...titles];
  const titleHeads = titleList.map((row) =>
    row.split(/\s*(?:[-—:|]|\bon\b)\s*/i)[0]?.trim() ?? row
  );
  const matchesAnyTitle = (claimed: string): boolean => {
    const normalized = normalizeIdentifier(claimed);
    if (titles.has(normalized)) return true;
    if (titleList.some((row) => row.includes(normalized))) return true;
    return titleHeads.some((head) => head.length > 0 && normalized.startsWith(head));
  };

  const failures: string[] = [];
  for (const title of extractQuotedTitles(content)) {
    if (!matchesAnyTitle(title)) {
      failures.push(`discussion title ${title} was not present in tool rows`);
    }
  }

  for (const candidate of extractListEntryHeads(content)) {
    if (!matchesAnyTitle(candidate)) {
      failures.push(`discussion title ${candidate} was not present in tool rows`);
    }
  }

  // Verify reply counts: e.g. `"Active Discussion" has 99 replies`
  for (const line of content.split("\n")) {
    const replyMatch = line.match(/"([^"\n]+)"\s+has\s+(\d+)\s+replies?/i);
    if (!replyMatch) continue;
    const titleKey = normalizeIdentifier(replyMatch[1] ?? "");
    const claimed = Number(replyMatch[2]);
    const expected = replyCountByTitle.get(titleKey);
    if (expected !== undefined && claimed !== expected) {
      failures.push(`reply count claim ${claimed} did not match ${expected}`);
    }
  }

  return failures;
}

export function verifyListJobPostings(content: string, data: unknown): string[] {
  if (!Array.isArray(data)) {
    return ["list_job_postings returned non-array data"];
  }

  type JobRow = { title?: unknown; company?: unknown };
  const rows = data as JobRow[];

  const titles = new Set(
    rows
      .map((row) =>
        row && typeof row === "object" && typeof row.title === "string"
          ? normalizeIdentifier(row.title)
          : null
      )
      .filter((value): value is string => Boolean(value))
  );

  const companies = new Set(
    rows
      .map((row) =>
        row && typeof row === "object" && typeof row.company === "string"
          ? normalizeIdentifier(row.company)
          : null
      )
      .filter((value): value is string => Boolean(value))
  );

  const failures: string[] = [];

  // Check count claims: "There are N job openings"
  const countMatch = content.match(/\b(\d+)\s+job\s+(?:openings?|postings?|listings?)\b/i);
  if (countMatch) {
    const claimed = Number(countMatch[1]);
    if (claimed !== data.length) {
      failures.push(`job posting count claim ${claimed} did not match ${data.length}`);
    }
  }

  for (const quoted of extractQuotedTitles(content)) {
    const normalized = normalizeIdentifier(quoted);
    // A quoted string must appear either as a title or company
    if (!titles.has(normalized) && !companies.has(normalized)) {
      failures.push(`job posting title ${quoted} was not present in tool rows`);
    }
  }

  for (const candidate of extractListEntryHeads(content)) {
    // List entries like "Software Engineer at Acme Corp" — check each part around " at "
    const parts = candidate.split(/\s+at\s+/i).map((p) => p.trim()).filter(Boolean);
    const allPartsKnown = parts.every(
      (part) => titles.has(normalizeIdentifier(part)) || companies.has(normalizeIdentifier(part))
    );
    if (!allPartsKnown) {
      // Only flag the first part (the title) if it's unknown
      const titlePart = parts[0] ?? candidate;
      if (!titles.has(normalizeIdentifier(titlePart)) && !companies.has(normalizeIdentifier(titlePart))) {
        failures.push(`job posting title ${titlePart} was not present in tool rows`);
      }
    }
  }

  return failures;
}

export function verifyListAnnouncements(content: string, data: unknown): string[] {
  if (!Array.isArray(data)) {
    return ["list_announcements returned non-array data"];
  }

  const titles = new Set(
    data
      .map((row) =>
        row && typeof row === "object" && typeof (row as { title?: unknown }).title === "string"
          ? normalizeIdentifier((row as { title: string }).title)
          : null
      )
      .filter((value): value is string => Boolean(value))
  );
  const dates = new Set(
    data.flatMap((row) =>
      row &&
      typeof row === "object" &&
      typeof (row as { published_at?: unknown }).published_at === "string"
        ? formatKnownEventDates((row as { published_at: string }).published_at)
        : []
    )
  );

  const failures: string[] = [];
  for (const title of extractQuotedTitles(content)) {
    if (!titles.has(normalizeIdentifier(title))) {
      failures.push(`announcement title ${title} was not present in tool rows`);
    }
  }

  for (const candidate of extractListEntryHeads(content)) {
    const normalizedCandidate = normalizeIdentifier(candidate);
    if (!titles.has(normalizedCandidate)) {
      failures.push(`announcement title ${candidate} was not present in tool rows`);
    }
  }

  for (const date of extractMentionedDates(content)) {
    if (!dates.has(date)) {
      failures.push(`announcement date ${date} was not present in tool rows`);
    }
  }

  return failures;
}

export function verifySuggestConnections(content: string, data: unknown): string[] {
  if (!data || typeof data !== "object") {
    return ["suggest_connections returned non-object data"];
  }

  const payload = data as SuggestConnectionGroundingData;
  const state = typeof payload.state === "string" ? payload.state : null;
  const failures: string[] = [];

  if (!state) {
    return ["suggest_connections returned missing state"];
  }

  if (state === "not_found") {
    if (extractListEntryHeads(content).length > 0) {
      failures.push("not_found response unexpectedly listed suggestions");
    }
    return failures;
  }

  if (state === "ambiguous") {
    const options = Array.isArray(payload.disambiguation_options)
      ? payload.disambiguation_options
      : [];
    const optionNames = new Set(
      options
        .map((row) =>
          row && typeof row === "object" && typeof (row as { name?: unknown }).name === "string"
            ? normalizeIdentifier((row as { name: string }).name)
            : null
        )
        .filter((value): value is string => Boolean(value))
    );

    for (const candidate of extractListEntryHeads(content)) {
      if (!optionNames.has(normalizeIdentifier(candidate))) {
        failures.push(`ambiguous option ${candidate} was not present in tool rows`);
      }
    }

    return failures;
  }

  if (state === "no_suggestions") {
    if (extractListEntryHeads(content).length > 0) {
      failures.push("no_suggestions response unexpectedly listed suggestions");
    }
    return failures;
  }

  if (state !== "resolved") {
    return [`suggest_connections returned unsupported state ${state}`];
  }

  const suggestions = payload.suggestions;
  if (!Array.isArray(suggestions)) {
    return ["suggest_connections returned non-array suggestions"];
  }

  const rows = suggestions as SuggestConnectionGroundingRow[];
  const rowByName = new Map(
    rows
      .map((row) => {
        const name = typeof row.name === "string" ? normalizeIdentifier(row.name) : null;
        return name ? [name, row] : null;
      })
      .filter((entry): entry is [string, SuggestConnectionGroundingRow] => Boolean(entry))
  );

  const renderedCandidates = extractListEntryHeads(content);
  for (const candidate of renderedCandidates) {
    const normalizedCandidate = normalizeIdentifier(candidate);
    if (!rowByName.has(normalizedCandidate)) {
      failures.push(`suggested connection ${candidate} was not present in tool rows`);
    }
  }

  const expectedOrder = rows
    .map((row) => (typeof row.name === "string" ? normalizeIdentifier(row.name) : null))
    .filter((value): value is string => Boolean(value));
  const renderedOrder = renderedCandidates
    .map((candidate) => normalizeIdentifier(candidate))
    .filter((candidate) => rowByName.has(candidate));

  if (
    renderedOrder.length > 1 &&
    renderedOrder.some((candidate, index) => candidate !== expectedOrder[index])
  ) {
    failures.push("suggested connections were rendered out of ranked order");
  }

  const sourceName =
    payload.source_person &&
    typeof payload.source_person === "object" &&
    typeof payload.source_person.name === "string"
      ? normalizeIdentifier(payload.source_person.name)
      : null;
  const sourceHeader = stripMarkdown(content)
    .split("\n")
    .find((line) => /top connections for/i.test(line));
  if (sourceName && sourceHeader) {
    const match = sourceHeader.match(/top connections for\s+(.+)/i);
    const renderedSource = match?.[1] ? normalizeIdentifier(match[1]) : null;
    if (renderedSource && renderedSource !== sourceName) {
      failures.push(`source person ${renderedSource} did not match ${sourceName}`);
    }
  }

  let activeSuggestedConnection: [string, SuggestConnectionGroundingRow] | null = null;

  for (const rawLine of content.split("\n")) {
    const line = stripMarkdown(rawLine).trim();
    if (!line) continue;

    const normalizedLine = normalizeIdentifier(line);

    for (const entry of rowByName) {
      const [normalizedName] = entry;
      if (normalizedLine.includes(normalizedName)) {
        activeSuggestedConnection = entry;
        break;
      }
    }

    const candidateEntry =
      /^why:/i.test(line) && activeSuggestedConnection ? activeSuggestedConnection : null;
    const rowEntry = candidateEntry ?? activeSuggestedConnection;
    if (!rowEntry) {
      continue;
    }

    const [, row] = rowEntry;
    const availableCodes = new Set(
      (row.reasons ?? [])
        .map((reason) => (typeof reason?.code === "string" ? reason.code : null))
        .filter((code): code is string => Boolean(code))
    );

    for (const code of extractSuggestConnectionReasonCodes(line)) {
      if (!availableCodes.has(code)) {
        failures.push(`suggested connection ${line} claimed unsupported reason ${code}`);
      }
    }
  }

  return failures;
}

export function verifySuggestMentors(content: string, data: unknown): string[] {
  if (!data || typeof data !== "object") {
    return ["suggest_mentors returned non-object data"];
  }

  const payload = data as SuggestMentorsGroundingData;
  const state = typeof payload.state === "string" ? payload.state : null;
  const failures: string[] = [];

  if (state === "unauthorized" || state === "not_found" || state === "ambiguous" || state === "no_suggestions") {
    return failures;
  }

  if (state !== "resolved") {
    failures.push(`suggest_mentors returned unexpected state: ${state}`);
    return failures;
  }

  const suggestions = payload.suggestions ?? [];
  if (suggestions.length === 0) return failures;

  // Build a map of mentor names → their reason codes
  const mentorReasonCodes = new Map<string, Set<string>>();
  for (const s of suggestions) {
    const name = typeof s.mentor?.name === "string" ? s.mentor.name.toLowerCase() : null;
    if (!name) continue;

    const codes = new Set<string>();
    for (const r of s.reasons ?? []) {
      if (typeof r.code === "string") codes.add(r.code);
    }
    mentorReasonCodes.set(name, codes);
  }

  // Verify that pass-2 response only references reason codes present in tool output
  const lines = content.split("\n");
  for (const line of lines) {
    if (!line.trim()) continue;

    const extractedCodes = extractMentorReasonCodes(line);
    if (extractedCodes.length === 0) continue;

    // Collect all available codes from all suggestions for this check
    const allAvailableCodes = new Set<string>();
    for (const codes of mentorReasonCodes.values()) {
      for (const c of codes) allAvailableCodes.add(c);
    }

    for (const code of extractedCodes) {
      if (!allAvailableCodes.has(code)) {
        failures.push(`suggest_mentors response claimed unsupported reason ${code}`);
      }
    }
  }

  return failures;
}
