import type { ToolName } from "@/lib/ai/tools/definitions";

export interface SuccessfulToolSummary {
  name: ToolName;
  data: unknown;
}

export interface ToolGroundingResult {
  grounded: boolean;
  failures: string[];
}

function normalizeIdentifier(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function stripMarkdown(value: string): string {
  return value.replace(/[*_`~>#"]/g, "").replace(/\[(.*?)\]\((.*?)\)/g, "$1").trim();
}

function normalizeMemberCandidate(value: string): string {
  return normalizeIdentifier(
    stripMarkdown(value)
      .replace(/\s+\((?:active member|admin|alumni|parent|email-only member|email-only admin)\)\s*$/i, "")
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

// Returns whole dollars from a currency claim adjacent to `label`. Supports
// comma thousands separators, 1–2 decimal places, and a trailing k/K suffix
// (e.g. "$1.2k" → 1200). Three-or-more decimal places fail to match and the
// function returns null so verifiers can flag them as unsupported.
export function parseCurrencyClaim(content: string, label: string): number | null {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = /\$([0-9][0-9,]*(?:\.[0-9]{1,2})?)(k|K)?(?![0-9.])/;
  for (const rawLine of content.split("\n")) {
    const line = rawLine.trim();
    if (!new RegExp(`\\b${escaped}\\b`, "i").test(line)) {
      continue;
    }

    const match = line.match(pattern);
    if (!match) {
      continue;
    }

    const parsed = Number.parseFloat(match[1].replace(/,/g, ""));
    if (!Number.isFinite(parsed)) {
      continue;
    }
    const scaled = match[2] ? parsed * 1000 : parsed;
    return Math.round(scaled);
  }

  return null;
}

// Extract every "$<amount>" token in content, returning whole-dollar values.
// Handles commas and optional k/K suffix. Skips malformed tokens.
function extractAllCurrencyDollars(content: string): number[] {
  const result: number[] = [];
  const globalPattern = /\$([0-9][0-9,]*(?:\.[0-9]{1,2})?)(k|K)?(?![0-9.])/g;
  let match: RegExpExecArray | null;
  while ((match = globalPattern.exec(content)) !== null) {
    const parsed = Number.parseFloat(match[1].replace(/,/g, ""));
    if (!Number.isFinite(parsed)) continue;
    const scaled = match[2] ? parsed * 1000 : parsed;
    result.push(Math.round(scaled));
  }
  return result;
}

function verifyOrgStats(content: string, data: unknown): string[] {
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

interface DonationAnalyticsVerifyPayload {
  totals?: {
    successful_donation_count?: unknown;
    successful_amount_cents?: unknown;
    average_successful_amount_cents?: unknown;
    largest_successful_amount_cents?: unknown;
  } | null;
  trend?: unknown;
  top_purposes?: unknown;
}

interface BucketRow {
  bucket_label: string;
  amount_cents: number;
}

interface PurposeRow {
  purpose: string;
  amount_cents: number;
}

function collectBucketRows(value: unknown): Map<string, BucketRow> {
  const map = new Map<string, BucketRow>();
  if (!Array.isArray(value)) return map;
  for (const row of value) {
    if (!row || typeof row !== "object") continue;
    const label = (row as { bucket_label?: unknown }).bucket_label;
    const cents = (row as { amount_cents?: unknown }).amount_cents;
    if (typeof label !== "string" || typeof cents !== "number") continue;
    map.set(normalizeIdentifier(label), { bucket_label: label, amount_cents: cents });
  }
  return map;
}

function collectPurposeRows(value: unknown): Map<string, PurposeRow> {
  const map = new Map<string, PurposeRow>();
  if (!Array.isArray(value)) return map;
  for (const row of value) {
    if (!row || typeof row !== "object") continue;
    const purpose = (row as { purpose?: unknown }).purpose;
    const cents = (row as { amount_cents?: unknown }).amount_cents;
    if (typeof purpose !== "string" || typeof cents !== "number") continue;
    map.set(normalizeIdentifier(purpose), { purpose, amount_cents: cents });
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

function contentIsGroundingFallback(content: string): boolean {
  // Matches copy emitted by getGroundingFallbackForTools — a static paraphrase
  // warning. Detect via shared sentinel phrase; ungrounded fallback bypasses
  // strict verification because it is deterministic server-controlled text.
  return /couldn[’']t verify|could not verify|unable to verify/i.test(content);
}

function verifyDonationAnalytics(content: string, data: unknown): string[] {
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

  const trendMap = collectBucketRows(payload.trend);
  const purposeMap = collectPurposeRows(payload.top_purposes);

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
      const expected = Math.round(row.amount_cents / 100);
      if (expected !== parsed.amountDollars) {
        failures.push(
          `trend amount claim $${parsed.amountDollars} did not match $${expected} for ${parsed.label}`
        );
      }
    } else if (inPurposesSection) {
      const key = normalizeIdentifier(parsed.label);
      const row = purposeMap.get(key);
      if (!row) {
        failures.push(`top purpose ${parsed.label} was not present in tool data`);
        continue;
      }
      const expected = Math.round(row.amount_cents / 100);
      if (expected !== parsed.amountDollars) {
        failures.push(
          `top purpose amount claim $${parsed.amountDollars} did not match $${expected} for ${parsed.label}`
        );
      }
    }
  }

  return failures;
}

interface ListDonationsRow {
  donor_name?: unknown;
  donor_email?: unknown;
  amount_dollars?: unknown;
  purpose?: unknown;
}

export interface ListDonationsGroundingContext {
  hideDonorNames?: boolean;
}

function verifyListDonations(
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

function extractListEntryHeads(content: string): string[] {
  return content
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => /^([-*]|\d+\.)\s+/.test(line))
    .map((line) => {
      const stripped = stripMarkdown(line.replace(/^([-*]|\d+\.)\s+/, ""));
      return stripped.split(/\s*(?:[-—:|]|\bon\b)\s*/i)[0]?.trim() ?? "";
    })
    .filter(Boolean);
}

function extractEmails(content: string): string[] {
  return [...new Set(content.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) ?? [])];
}

function answerStatesListIsPartial(content: string): boolean {
  return /\b(partial|showing|first|latest|recent|top)\b/i.test(content);
}

function verifyListMembers(content: string, data: unknown): string[] {
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

function extractQuotedTitles(content: string): string[] {
  return [...content.matchAll(/"([^"\n]+)"/g)].map((match) => stripMarkdown(match[1] ?? ""));
}

function extractMentionedDates(content: string): string[] {
  const isoMatches = content.match(/\b\d{4}-\d{2}-\d{2}\b/g) ?? [];
  const longMatches = content.match(
    /\b(?:january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{1,2},\s+\d{4}\b/gi
  ) ?? [];
  return [...new Set([...isoMatches, ...longMatches].map((value) => value.toLowerCase()))];
}

function verifyListEvents(content: string, data: unknown): string[] {
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

function verifyListDiscussions(content: string, data: unknown): string[] {
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

  const failures: string[] = [];
  for (const title of extractQuotedTitles(content)) {
    if (!titles.has(normalizeIdentifier(title))) {
      failures.push(`discussion title ${title} was not present in tool rows`);
    }
  }

  for (const candidate of extractListEntryHeads(content)) {
    const normalizedCandidate = normalizeIdentifier(candidate);
    if (!titles.has(normalizedCandidate)) {
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

function verifyListJobPostings(content: string, data: unknown): string[] {
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

function verifyListAnnouncements(content: string, data: unknown): string[] {
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

interface SuggestConnectionGroundingReason {
  code?: unknown;
  label?: unknown;
}

interface SuggestConnectionGroundingRow {
  name?: unknown;
  reasons?: SuggestConnectionGroundingReason[];
}

interface SuggestConnectionGroundingData {
  state?: unknown;
  source_person?: { name?: unknown } | null;
  suggestions?: unknown;
  disambiguation_options?: unknown;
}

function extractSuggestConnectionReasonCodes(line: string): string[] {
  const matches = new Set<string>();
  const normalized = line.toLowerCase();

  if (/(direct mentorship|second[- ]degree mentorship|second degree|two[- ]hop mentorship|two hop)/.test(normalized)) {
    matches.add("unsupported_mentorship");
  }
  if (/(shared company|same company)/.test(normalized)) {
    matches.add("shared_company");
  }
  if (/(shared industry|same industry)/.test(normalized)) {
    matches.add("shared_industry");
  }
  if (/(shared role family|same role family|similar role family)/.test(normalized)) {
    matches.add("shared_role_family");
  }
  if (/(graduation proximity|graduated within 3 years|within 3 years of graduating|similar graduation year)/.test(normalized)) {
    matches.add("graduation_proximity");
  }
  if (/(shared graduation year|same graduation year|class of)/.test(normalized)) {
    matches.add("graduation_proximity");
  }
  if (/(shared city|same city|both (?:live|based|located) in)/.test(normalized)) {
    matches.add("shared_city");
  }

  return [...matches];
}

function verifySuggestConnections(content: string, data: unknown): string[] {
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

interface SuggestMentorsGroundingData {
  state?: unknown;
  mentee?: { name?: unknown } | null;
  suggestions?: Array<{
    mentor?: { name?: unknown } | null;
    reasons?: Array<{ code?: unknown; label?: unknown }>;
  }>;
}

function extractMentorReasonCodes(line: string): string[] {
  const matches = new Set<string>();
  const normalized = line.toLowerCase();

  if (/(shared topics?)/.test(normalized)) matches.add("shared_topics");
  if (/(shared industry|same industry)/.test(normalized)) matches.add("shared_industry");
  if (/(shared role family|same role family|similar role)/.test(normalized)) matches.add("shared_role_family");
  if (/(graduation gap|years? ahead|graduation fit)/.test(normalized)) matches.add("graduation_gap_fit");
  if (/(shared city|same city|both (?:live|based) in)/.test(normalized)) matches.add("shared_city");
  if (/(shared company|same company)/.test(normalized)) matches.add("shared_company");

  return [...matches];
}

function verifySuggestMentors(content: string, data: unknown): string[] {
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

export interface VerifyToolBackedResponseInput {
  content: string;
  toolResults: SuccessfulToolSummary[];
  orgContext?: { hideDonorNames?: boolean };
}

export function verifyToolBackedResponse(
  input: VerifyToolBackedResponseInput
): ToolGroundingResult {
  const failures: string[] = [];
  const hasSuggestConnections = input.toolResults.some(
    (result) => result.name === "suggest_connections"
  );

  for (const result of input.toolResults) {
    switch (result.name) {
      case "get_org_stats":
        failures.push(...verifyOrgStats(input.content, result.data));
        break;
      case "get_donation_analytics":
        failures.push(...verifyDonationAnalytics(input.content, result.data));
        break;
      case "list_donations":
        failures.push(
          ...verifyListDonations(input.content, result.data, {
            hideDonorNames: input.orgContext?.hideDonorNames === true,
          })
        );
        break;
      case "list_members":
        if (!hasSuggestConnections) {
          failures.push(...verifyListMembers(input.content, result.data));
        }
        break;
      case "list_events":
        failures.push(...verifyListEvents(input.content, result.data));
        break;
      case "list_announcements":
        failures.push(...verifyListAnnouncements(input.content, result.data));
        break;
      case "list_discussions":
        failures.push(...verifyListDiscussions(input.content, result.data));
        break;
      case "list_job_postings":
        failures.push(...verifyListJobPostings(input.content, result.data));
        break;
      case "suggest_connections":
        failures.push(...verifySuggestConnections(input.content, result.data));
        break;
      case "suggest_mentors":
        failures.push(...verifySuggestMentors(input.content, result.data));
        break;
      default:
        // No grounding check for this tool
        break;
    }
  }

  return {
    grounded: failures.length === 0,
    failures,
  };
}
