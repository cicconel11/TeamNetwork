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
  return value.replace(/[*_`~>#]/g, "").replace(/\[(.*?)\]\((.*?)\)/g, "$1").trim();
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
    const normalizedCandidate = normalizeIdentifier(candidate);
    if (
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

  if (/direct mentorship/.test(normalized)) {
    matches.add("direct_mentorship");
  }
  if (/(second[- ]degree mentorship|second degree|two[- ]hop mentorship|two hop)/.test(normalized)) {
    matches.add("second_degree_mentorship");
  }
  if (/(shared company|same company)/.test(normalized)) {
    matches.add("shared_company");
  }
  if (/(shared industry|same industry)/.test(normalized)) {
    matches.add("shared_industry");
  }
  if (/(shared major|same major|both studied)/.test(normalized)) {
    matches.add("shared_major");
  }
  if (/(shared graduation year|same graduation year|class of)/.test(normalized)) {
    matches.add("shared_graduation_year");
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
    .find((line) => /should connect with/i.test(line));
  if (sourceName && sourceHeader) {
    const match = sourceHeader.match(/who\s+(.+?)\s+should connect with/i);
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

export function verifyToolBackedResponse(input: {
  content: string;
  toolResults: SuccessfulToolSummary[];
}): ToolGroundingResult {
  const failures: string[] = [];
  const hasSuggestConnections = input.toolResults.some(
    (result) => result.name === "suggest_connections"
  );

  for (const result of input.toolResults) {
    switch (result.name) {
      case "get_org_stats":
        failures.push(...verifyOrgStats(input.content, result.data));
        break;
      case "list_members":
        if (!hasSuggestConnections) {
          failures.push(...verifyListMembers(input.content, result.data));
        }
        break;
      case "list_events":
        failures.push(...verifyListEvents(input.content, result.data));
        break;
      case "suggest_connections":
        failures.push(...verifySuggestConnections(input.content, result.data));
        break;
    }
  }

  return {
    grounded: failures.length === 0,
    failures,
  };
}
