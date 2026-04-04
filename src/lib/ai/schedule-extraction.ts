import type OpenAI from "openai";
import { z } from "zod";
import { createZaiClient, getZaiImageModel, getZaiModel } from "@/lib/ai/client";

const MAX_SOURCE_TEXT_CHARS = 12_000;
const MAX_SOURCE_TEXT_CHUNK_COUNT = 4;
const MAX_EXTRACTED_EVENTS = 25;
const MAX_REJECTED_ROWS = 25;
const REQUIRED_EVENT_FIELDS = ["title", "start_date", "start_time"] as const;
const PDF_MONTH_INDEX: Record<string, string> = {
  jan: "01",
  feb: "02",
  mar: "03",
  apr: "04",
  may: "05",
  jun: "06",
  jul: "07",
  aug: "08",
  sep: "09",
  sept: "09",
  oct: "10",
  nov: "11",
  dec: "12",
};
const PDF_DATE_PATTERN =
  /\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\s+(\d{1,2})\s+(\d{4})\b/i;
const PDF_TIME_PATTERN = /\b(\d{1,2}:\d{2})\s*([AaPp])[.]?[Mm][.]?\b/;
const PDF_CHROME_PHRASES = [
  "fordham preparatory school",
  "fordhampreparatoryschool",
  "faith, scholarship, and service",
  "admissions",
  "alumni",
  "giving",
  "search",
  "about teams",
  "master schedule",
  "sports streams",
  "home of champions",
  "athletic facilities",
  "who we are",
  "mailing address",
  "directions",
  "contact us",
  "privacy policy",
  "accessibility policy",
  "sitemap",
  "program coaches schedule",
];
const PDF_SCHEDULE_SIGNAL_PATTERN =
  /\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec|am|pm|vs\.?|@\b|\d{1,2}:\d{2}|\d{4})\b/i;
const PDF_SCHEDULE_HEADER_PATTERN =
  /\bteam\b.*\bopponent\b.*\bdate\b.*\btime\b.*\blocation\b/i;
const PDF_RESULT_PATTERN = /\b(?:result|score)\b/i;
const PDF_TEAM_LEVEL_PATTERN = /\b(?:varsity|junior|freshman|jv)\b/i;
const PDF_SPORT_PATTERN =
  /\b(?:baseball|basketball|football|soccer|lacrosse|softball|volleyball|wrestling|tennis|golf|track|cross country|swimming|rowing|crew|hockey|rugby)\b/i;
const defaultDeps: ScheduleExtractionDeps = {
  createClient: createZaiClient,
  getTextModel: getZaiModel,
  getImageModel: getZaiImageModel,
};
let testDeps: ScheduleExtractionDeps | null = null;

type ScheduleExtractionSourceType = "website" | "pdf" | "image";

type ScheduleExtractionContext = {
  orgName?: string;
  sourceType: ScheduleExtractionSourceType;
  sourceLabel: string;
  now: string;
};

type ScheduleExtractionDeps = {
  createClient: () => OpenAI;
  getTextModel: () => string;
  getImageModel: () => string;
};

export type ScheduleImageMimeType = "image/png" | "image/jpeg" | "image/jpg";

export interface ExtractedScheduleEvent {
  title: string;
  start_date: string;
  start_time: string;
  end_date?: string;
  end_time?: string;
  location?: string;
  description?: string;
  event_type?: "general" | "philanthropy" | "game" | "practice" | "meeting" | "social" | "workout" | "fundraiser" | "class";
}

export interface ExtractedScheduleRejectedRow {
  index: number;
  missing_fields: string[];
  draft: Record<string, unknown>;
}

export interface ScheduleExtractionResult {
  events: ExtractedScheduleEvent[];
  rejected_rows: ExtractedScheduleRejectedRow[];
  source_summary: string;
  confidence: "high" | "medium" | "low";
  diagnostics?: {
    strategy: "pdf_parser" | "llm_fallback" | "llm" | "image_model";
    cleaned_line_count?: number;
    parsed_row_count?: number;
    candidate_row_count?: number;
  };
}

const extractedScheduleEventSchema: z.ZodType<ExtractedScheduleEvent> = z.object({
  title: z.string().trim().min(1).max(200),
  start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  start_time: z.string().regex(/^\d{2}:\d{2}$/),
  end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  end_time: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  location: z.string().trim().min(1).max(500).optional(),
  description: z.string().trim().min(1).max(5000).optional(),
  event_type: z
    .enum(["general", "philanthropy", "game", "practice", "meeting", "social", "workout", "fundraiser", "class"])
    .optional(),
});

const confidenceSchema = z.enum(["high", "medium", "low"]);

function getScheduleExtractionDeps(): ScheduleExtractionDeps {
  return testDeps ?? defaultDeps;
}

export function setScheduleExtractionDepsForTests(
  overrides: Partial<ScheduleExtractionDeps> | null
): void {
  testDeps = overrides ? { ...defaultDeps, ...overrides } : null;
}

export async function extractScheduleFromText(
  text: string,
  context: ScheduleExtractionContext
): Promise<ScheduleExtractionResult> {
  const preparedText = prepareScheduleSourceText(text, context);

  if (context.sourceType === "pdf") {
    const parsedPdf = parsePdfSportsSchedule(preparedText, context);
    if (parsedPdf.events.length > 0 || parsedPdf.rejected_rows.length > 0) {
      return parsedPdf;
    }
  }

  const chunks = chunkScheduleSourceText(preparedText);

  if (chunks.length === 0) {
    return {
      events: [],
      rejected_rows: [],
      source_summary: `No usable text found in ${context.sourceLabel}.`,
      confidence: "low",
      diagnostics:
        context.sourceType === "pdf"
          ? {
              strategy: "llm_fallback",
              cleaned_line_count: countLines(preparedText),
              parsed_row_count: 0,
              candidate_row_count: 0,
            }
          : undefined,
    };
  }

  const deps = getScheduleExtractionDeps();
  const client = deps.createClient();
  const results: ScheduleExtractionResult[] = [];

  for (const chunk of chunks) {
    const messages = buildTextMessages(chunk, context);
    const initialResponse = await requestExtraction({
      client,
      model: deps.getTextModel(),
      messages,
      temperature: 0.2,
    });

    try {
      results.push(parseExtractionResponse(initialResponse, context));
      continue;
    } catch (error) {
      if (!(error instanceof SyntaxError)) {
        throw error;
      }
    }

    const retryResponse = await requestExtraction({
      client,
      model: deps.getTextModel(),
      messages,
      temperature: 0,
    });
    results.push(parseExtractionResponse(retryResponse, context));
  }

  const merged = mergeExtractionResults(results, context);
  return {
    ...merged,
    diagnostics: {
      strategy:
        context.sourceType === "pdf"
          ? "llm_fallback"
          : context.sourceType === "image"
          ? "image_model"
          : "llm",
      cleaned_line_count: context.sourceType === "pdf" ? countLines(preparedText) : undefined,
      parsed_row_count: merged.events.length,
      candidate_row_count: merged.rejected_rows.length,
    },
  };
}

export async function extractScheduleFromImage(
  image: {
    url: string;
    mimeType: ScheduleImageMimeType;
  },
  context: Omit<ScheduleExtractionContext, "sourceType"> & {
    sourceType?: Extract<ScheduleExtractionSourceType, "image">;
  }
): Promise<ScheduleExtractionResult> {
  const deps = getScheduleExtractionDeps();
  const client = deps.createClient();
  const normalizedContext: ScheduleExtractionContext = {
    ...context,
    sourceType: "image",
  };
  const messages = buildImageMessages(image, normalizedContext);

  const initialResponse = await requestExtraction({
    client,
    model: deps.getImageModel(),
    messages,
    temperature: 0.2,
  });

  try {
    return parseExtractionResponse(initialResponse, normalizedContext);
  } catch (error) {
    if (!(error instanceof SyntaxError)) {
      throw error;
    }

    const retryResponse = await requestExtraction({
      client,
      model: deps.getImageModel(),
      messages,
      temperature: 0,
    });

    return parseExtractionResponse(retryResponse, normalizedContext);
  }
}

async function requestExtraction(params: {
  client: OpenAI;
  model: string;
  messages: OpenAI.Chat.ChatCompletionMessageParam[];
  temperature: number;
}): Promise<string> {
  const { client, model, messages, temperature } = params;

  try {
    const completion = await client.chat.completions.create({
      model,
      temperature,
      max_tokens: 2500,
      response_format: { type: "json_object" },
      messages,
    });

    return readCompletionText(completion);
  } catch (error) {
    if (!supportsPromptOnlyJsonFallback(error)) {
      throw error;
    }

    const completion = await client.chat.completions.create({
      model,
      temperature,
      max_tokens: 2500,
      messages,
    });

    return readCompletionText(completion);
  }
}

function buildSystemPrompt(context: ScheduleExtractionContext): string {
  const orgLine = context.orgName
    ? `Organization: ${context.orgName}`
    : "Organization: unknown";

  return [
    "You extract structured calendar events from uploaded schedule sources.",
    "Return only a single JSON object with keys: events, candidate_rows, source_summary, confidence.",
    "Each event must use YYYY-MM-DD for dates and HH:MM 24-hour time for times.",
    "Only include events that are explicitly present or strongly implied by the source.",
    "Resolve relative dates against the provided current timestamp.",
    "If a required event field is missing or ambiguous, omit that event from events instead of inventing values.",
    "If a schedule row is readable but still missing required fields, include it in candidate_rows with whatever fields you can confidently read plus raw_text when helpful.",
    "Valid event_type values are general, philanthropy, game, practice, meeting, social, workout, fundraiser, class.",
    "Keep source_summary concise and factual.",
    `Current timestamp for date resolution: ${context.now}`,
    orgLine,
  ].join("\n");
}

function buildTextMessages(
  truncatedText: string,
  context: ScheduleExtractionContext
): OpenAI.Chat.ChatCompletionMessageParam[] {
  return [
    {
      role: "system",
      content: buildSystemPrompt(context),
    },
    {
      role: "user",
      content: [
        `Source type: ${context.sourceType}`,
        `Source label: ${context.sourceLabel}`,
        "Extract schedule events from this text:",
        truncatedText,
      ].join("\n\n"),
    },
  ];
}

function buildImageMessages(
  image: {
    url: string;
    mimeType: ScheduleImageMimeType;
  },
  context: ScheduleExtractionContext
): OpenAI.Chat.ChatCompletionMessageParam[] {
  return [
    {
      role: "system",
      content: buildSystemPrompt(context),
    },
    {
      role: "user",
      content: [
        {
          type: "text",
          text: [
            `Source type: ${context.sourceType}`,
            `Source label: ${context.sourceLabel}`,
            `Source MIME type: ${image.mimeType}`,
            "Extract schedule events from this image.",
          ].join("\n\n"),
        },
        {
          type: "image_url",
          image_url: {
            url: image.url,
          },
        },
      ],
    },
  ];
}

function prepareScheduleSourceText(
  text: string,
  context: ScheduleExtractionContext
): string {
  if (context.sourceType === "pdf") {
    return cleanPdfExtractedText(text);
  }

  return text.replace(/\s+/g, " ").trim();
}

function cleanPdfExtractedText(text: string): string {
  const rawLines = text
    .split(/\r?\n+/)
    .map((line) => normalizePdfLine(line))
    .filter((line) => line.length > 0);
  const cleanedLines: string[] = [];
  const seenNonEventLines = new Set<string>();

  for (const line of rawLines) {
    if (isLikelyPdfChromeLine(line)) {
      continue;
    }

    const previousLine = cleanedLines[cleanedLines.length - 1];
    if (previousLine === line) {
      continue;
    }

    if (!hasScheduleSignal(line)) {
      const dedupeKey = line.toLowerCase();
      if (seenNonEventLines.has(dedupeKey)) {
        continue;
      }
      seenNonEventLines.add(dedupeKey);
    }

    cleanedLines.push(line);
  }

  return cleanedLines.join("\n").trim();
}

function normalizePdfLine(line: string): string {
  const compactWhitespace = line.replace(/\t+/g, " ").replace(/\s{2,}/g, " ").trim();
  if (compactWhitespace.length === 0) {
    return "";
  }

  const fullyCollapsed = compactWhitespace.replace(
    /\b(?:[A-Za-z]\s+){2,}[A-Za-z]\b/g,
    (match) => match.replace(/\s+/g, "")
  );
  const mergedFragments = mergePdfWordFragments(fullyCollapsed.split(/\s+/)).join(" ");

  return collapseRepeatedPdfLineSegments(
    mergedFragments
      .replace(/\b([A-Za-z]+)(?:\1){1,}\b/g, "$1")
      .replace(/\b([A-Z][a-z]{2,})\s+([a-z]{2,})\b/g, "$1$2")
      .replace(/([A-Za-z])((?:vs|Vs)\.?)/g, "$1 $2")
      .replace(/([A-Za-z]{2,})(?=(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\b)/g, "$1 ")
      .replace(/\s*-\s*/g, " - ")
      .replace(/\s{2,}/g, " ")
      .trim()
  );
}

function collapseRepeatedPdfLineSegments(line: string): string {
  const tokens = line.split(/\s+/);
  const maxSegmentLength = Math.min(6, Math.floor(tokens.length / 2));

  for (let segmentLength = maxSegmentLength; segmentLength >= 2; segmentLength -= 1) {
    const segment = tokens.slice(0, segmentLength).join(" ");
    if (!looksLikeRepeatedPdfTeamSegment(segment)) {
      continue;
    }

    let repeats = 1;
    let offset = segmentLength;
    while (
      offset + segmentLength <= tokens.length
      && tokens.slice(offset, offset + segmentLength).join(" ").toLowerCase() === segment.toLowerCase()
    ) {
      offset += segmentLength;
      repeats += 1;
    }

    if (repeats >= 2) {
      return `${segment} ${tokens.slice(offset).join(" ")}`.trim();
    }
  }

  return line;
}

function looksLikeRepeatedPdfTeamSegment(segment: string): boolean {
  return PDF_SPORT_PATTERN.test(segment)
    || PDF_TEAM_LEVEL_PATTERN.test(segment)
    || segment.includes(" - ");
}

function isMergeablePdfWordFragment(token: string): boolean {
  return /^[A-Za-z]{1,3}$/.test(token);
}

function mergePdfWordFragments(tokens: string[]): string[] {
  const merged: string[] = [];

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index] ?? "";
    if (!isMergeablePdfWordFragment(token)) {
      merged.push(token);
      continue;
    }

    const parts = [token];
    let nextIndex = index + 1;
    while (nextIndex < tokens.length && isMergeablePdfWordFragment(tokens[nextIndex] ?? "")) {
      parts.push(tokens[nextIndex] ?? "");
      nextIndex += 1;
    }

    if (parts.length >= 2) {
      merged.push(parts.join(""));
      index = nextIndex - 1;
      continue;
    }

    merged.push(token);
  }

  return merged;
}

function isLikelyPdfChromeLine(line: string): boolean {
  if (hasScheduleSignal(line)) {
    return false;
  }

  const lowerLine = line.toLowerCase();
  return PDF_CHROME_PHRASES.some((phrase) => lowerLine.includes(phrase));
}

function hasScheduleSignal(line: string): boolean {
  return PDF_SCHEDULE_SIGNAL_PATTERN.test(line);
}

function parsePdfSportsSchedule(
  text: string,
  context: ScheduleExtractionContext
): ScheduleExtractionResult {
  const cleanedLines = text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const scheduleLines = slicePdfScheduleLines(cleanedLines);
  const blocks = buildPdfScheduleBlocks(scheduleLines);
  const events: ExtractedScheduleEvent[] = [];
  const rejectedRows: ExtractedScheduleRejectedRow[] = [];
  const seenEventKeys = new Set<string>();
  const seenRejectedKeys = new Set<string>();

  for (const block of blocks) {
    const candidate = buildPdfScheduleCandidate(block);
    if (!candidate) {
      continue;
    }

    const normalized = normalizeScheduleCandidate(candidate);
    if (!normalized) {
      continue;
    }

    if ("event" in normalized) {
      const eventKey = buildEventKey(normalized.event);
      if (seenEventKeys.has(eventKey)) {
        continue;
      }

      seenEventKeys.add(eventKey);
      events.push(normalized.event);
      continue;
    }

    const rejectionKey = buildRejectedRowKey(normalized.rejected);
    if (seenRejectedKeys.has(rejectionKey)) {
      continue;
    }

    seenRejectedKeys.add(rejectionKey);
    rejectedRows.push({
      index: rejectedRows.length,
      missing_fields: normalized.rejected.missing_fields,
      draft: normalized.rejected.draft,
    });
  }

  return {
    events: events.slice(0, MAX_EXTRACTED_EVENTS),
    rejected_rows: rejectedRows.slice(0, MAX_REJECTED_ROWS),
    source_summary:
      events.length > 0 || rejectedRows.length > 0
        ? `Parsed athletic schedule rows from ${context.sourceLabel}.`
        : `No usable text found in ${context.sourceLabel}.`,
    confidence: events.length > 0 ? "high" : rejectedRows.length > 0 ? "medium" : "low",
    diagnostics: {
      strategy: "pdf_parser",
      cleaned_line_count: cleanedLines.length,
      parsed_row_count: events.length,
      candidate_row_count: rejectedRows.length,
    },
  };
}

function slicePdfScheduleLines(lines: string[]): string[] {
  const headerIndex = lines.findIndex((line) => PDF_SCHEDULE_HEADER_PATTERN.test(line));
  if (headerIndex >= 0) {
    return lines.slice(headerIndex + 1);
  }

  return lines.filter((line) => looksLikePdfScheduleLine(line));
}

function buildPdfScheduleBlocks(lines: string[]): string[] {
  const blocks: string[] = [];
  let current: string[] = [];

  for (const rawLine of lines) {
    const line = normalizePdfBlockLine(rawLine);
    if (line.length === 0 || PDF_SCHEDULE_HEADER_PATTERN.test(line)) {
      continue;
    }

    if (current.length === 0) {
      if (!looksLikePdfScheduleLine(line)) {
        continue;
      }
      current = [line];
      continue;
    }

    const currentText = normalizePdfBlockText(current.join(" "));
    if (hasPdfDateAndTime(currentText) && looksLikePdfBlockBoundary(line)) {
      const finalized = normalizePdfBlockText(current.join(" "));
      if (finalized.length > 0) {
        blocks.push(finalized);
      }
      current = [line];
      continue;
    }

    current.push(line);
  }

  if (current.length > 0) {
    const finalized = normalizePdfBlockText(current.join(" "));
    if (finalized.length > 0) {
      blocks.push(finalized);
    }
  }

  return blocks;
}

function normalizePdfBlockLine(line: string): string {
  return line
    .replace(/\s+/g, " ")
    .replace(/\b([A-Za-z]+)(?:\1){1,}\b/g, "$1")
    .trim();
}

function normalizePdfBlockText(text: string): string {
  return collapseRepeatedPdfLineSegments(
    text
      .replace(/\s+/g, " ")
      .replace(/\b([A-Za-z]+)(?:\1){1,}\b/g, "$1")
      .replace(/\s*-\s*/g, " - ")
      .trim()
  );
}

function looksLikePdfScheduleLine(line: string): boolean {
  return hasScheduleSignal(line)
    || PDF_SPORT_PATTERN.test(line)
    || PDF_TEAM_LEVEL_PATTERN.test(line)
    || PDF_RESULT_PATTERN.test(line);
}

function looksLikePdfBlockBoundary(line: string): boolean {
  return looksLikePdfScheduleLine(line)
    && (PDF_SPORT_PATTERN.test(line) || /\b(?:vs\.?|@)\b/i.test(line) || hasPdfDate(line));
}

function hasPdfDate(line: string): boolean {
  return PDF_DATE_PATTERN.test(line);
}

function hasPdfTime(line: string): boolean {
  return PDF_TIME_PATTERN.test(line);
}

function hasPdfDateAndTime(line: string): boolean {
  return hasPdfDate(line) && hasPdfTime(line);
}

function buildPdfScheduleCandidate(block: string): Record<string, unknown> | null {
  const dateMatch = block.match(PDF_DATE_PATTERN);
  if (!dateMatch || dateMatch.index == null) {
    return null;
  }

  const startDate = normalizePdfMonthDate(dateMatch);
  if (!startDate) {
    return null;
  }

  const beforeDate = block.slice(0, dateMatch.index).trim();
  const afterDate = block.slice(dateMatch.index + dateMatch[0].length).trim();
  const timeMatch = afterDate.match(PDF_TIME_PATTERN);
  const afterTime =
    timeMatch && timeMatch.index != null
      ? afterDate.slice(timeMatch.index + timeMatch[0].length).trim()
      : afterDate;
  const startTime = normalizeTimeValue(
    timeMatch ? `${timeMatch[1] ?? ""} ${timeMatch[2] ?? ""}M` : undefined
  );
  const titleParts = parsePdfTitleAndLocation(beforeDate);
  const detailParts = splitPdfLocationAndDescription(afterTime);
  const location = [titleParts.location, detailParts.location]
    .filter((value): value is string => typeof value === "string" && value.length > 0)
    .join(" ")
    .trim();

  const candidate: Record<string, unknown> = {
    raw_text: block,
    start_date: startDate,
    event_type: "game",
  };

  if (titleParts.title) {
    candidate.title = titleParts.title;
  }
  if (startTime) {
    candidate.start_time = startTime;
  }
  if (location.length > 0) {
    candidate.location = location;
  }
  if (detailParts.description) {
    candidate.description = detailParts.description;
  }

  return candidate;
}

function normalizePdfMonthDate(match: RegExpMatchArray): string | undefined {
  const month = PDF_MONTH_INDEX[(match[1] ?? "").toLowerCase()];
  const day = match[2];
  const year = match[3];

  if (!month || !day || !year) {
    return undefined;
  }

  return `${year}-${month}-${day.padStart(2, "0")}`;
}

function parsePdfTitleAndLocation(beforeDate: string): {
  title?: string;
  location?: string;
} {
  const normalized = normalizePdfTitleFragment(beforeDate);
  const match = normalized.match(/^(.*?)\s+(vs\.?|Vs\.?|@)\s+(.+)$/);

  if (!match) {
    return {
      title: normalized.length > 0 ? normalized : undefined,
    };
  }

  const prefix = normalizePdfTitleFragment(match[1] ?? "");
  const separator = (match[2] ?? "").toLowerCase() === "@" ? "@" : "vs.";
  const rest = normalizePdfTitleFragment(match[3] ?? "");

  if (separator === "@") {
    return {
      title: `${prefix} @ ${rest}`.trim(),
    };
  }

  const locationMatch = rest.match(/^(.*?)\s+@\s+(.+)$/);
  if (locationMatch) {
    return {
      title: `${prefix} vs. ${normalizePdfTitleFragment(locationMatch[1] ?? "")}`.trim(),
      location: normalizePdfTitleFragment(locationMatch[2] ?? ""),
    };
  }

  return {
    title: `${prefix} vs. ${rest}`.trim(),
  };
}

function normalizePdfTitleFragment(value: string): string {
  return value
    .replace(/\b(Freshman|Varsity|Junior)\s*([A-Za-z]+)/g, "$1 $2")
    .replace(/\b([A-Za-z]{2,})(?=(HS|School|Catholic|Prep|Park|Field)\b)/g, "$1 ")
    .replace(/\s+/g, " ")
    .replace(/\s*-\s*/g, " - ")
    .trim();
}

function splitPdfLocationAndDescription(text: string): {
  location?: string;
  description?: string;
} {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length === 0) {
    return {};
  }

  const resultIndex = normalized.search(PDF_RESULT_PATTERN);
  if (resultIndex >= 0) {
    const location = normalized.slice(0, resultIndex).trim();
    const description = normalized
      .slice(resultIndex)
      .replace(/\s*-\s*/g, "-")
      .trim();
    return {
      location: location.length > 0 ? location : undefined,
      description: description.length > 0 ? description : undefined,
    };
  }

  return { location: normalized };
}

function countLines(text: string): number {
  if (text.trim().length === 0) {
    return 0;
  }

  return text.split("\n").filter((line) => line.trim().length > 0).length;
}

function chunkScheduleSourceText(text: string): string[] {
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return [];
  }

  const lines = trimmed.split("\n").map((line) => line.trim()).filter(Boolean);
  if (lines.length === 0) {
    return [];
  }

  const chunks: string[] = [];
  let currentChunk = "";

  for (const line of lines) {
    const nextChunk = currentChunk.length > 0 ? `${currentChunk}\n${line}` : line;
    if (nextChunk.length <= MAX_SOURCE_TEXT_CHARS) {
      currentChunk = nextChunk;
      continue;
    }

    if (currentChunk.length > 0) {
      chunks.push(currentChunk);
      if (chunks.length >= MAX_SOURCE_TEXT_CHUNK_COUNT) {
        return chunks;
      }
    }

    currentChunk = line.slice(0, MAX_SOURCE_TEXT_CHARS);
  }

  if (currentChunk.length > 0 && chunks.length < MAX_SOURCE_TEXT_CHUNK_COUNT) {
    chunks.push(currentChunk);
  }

  return chunks;
}

function mergeExtractionResults(
  results: ScheduleExtractionResult[],
  context: ScheduleExtractionContext
): ScheduleExtractionResult {
  const events: ExtractedScheduleEvent[] = [];
  const rejectedRowsByKey = new Map<
    string,
    Omit<ExtractedScheduleRejectedRow, "index">
  >();
  const seenEventKeys = new Set<string>();
  let bestConfidence: ScheduleExtractionResult["confidence"] = "low";

  for (const result of results) {
    if (confidenceRank(result.confidence) > confidenceRank(bestConfidence)) {
      bestConfidence = result.confidence;
    }

    for (const event of result.events) {
      const eventKey = buildEventKey(event);
      if (seenEventKeys.has(eventKey)) {
        continue;
      }

      seenEventKeys.add(eventKey);
      events.push(event);
      if (events.length >= MAX_EXTRACTED_EVENTS) {
        break;
      }
    }

    for (const row of result.rejected_rows) {
      const rejectionKey = buildRejectedRowKey(row);
      const existing = rejectedRowsByKey.get(rejectionKey);
      if (!existing || getDraftSignalScore(row.draft) > getDraftSignalScore(existing.draft)) {
        rejectedRowsByKey.set(rejectionKey, {
          missing_fields: row.missing_fields,
          draft: row.draft,
        });
      }
    }
  }

  return {
    events,
    rejected_rows: Array.from(rejectedRowsByKey.values())
      .slice(0, MAX_REJECTED_ROWS)
      .map((row, index) => ({
        index,
        missing_fields: row.missing_fields,
        draft: row.draft,
      })),
    source_summary: `Extracted schedule candidates from ${context.sourceLabel}.`,
    confidence: bestConfidence,
  };
}

function confidenceRank(value: ScheduleExtractionResult["confidence"]): number {
  switch (value) {
    case "high":
      return 3;
    case "medium":
      return 2;
    default:
      return 1;
  }
}

function readCompletionText(response: OpenAI.Chat.ChatCompletion): string {
  const content: unknown = response.choices[0]?.message?.content;

  if (typeof content === "string") {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .map((part: unknown) => {
        if (typeof part === "string") {
          return part;
        }

        if (part && typeof part === "object" && "type" in part && part.type === "text") {
          const text = "text" in part ? part.text : "";
          return typeof text === "string" ? text : "";
        }

        return "";
      })
      .join("");
  }

  return "";
}

function parseExtractionResponse(
  rawResponse: string,
  context: ScheduleExtractionContext
): ScheduleExtractionResult {
  const normalizedJson = normalizeJsonText(rawResponse);
  const parsed = JSON.parse(normalizedJson) as Record<string, unknown>;

  const rawEvents = Array.isArray(parsed.events) ? parsed.events : [];
  const rawCandidateRows = Array.isArray(parsed.candidate_rows)
    ? parsed.candidate_rows
    : Array.isArray(parsed.rows)
    ? parsed.rows
    : [];
  const events: ExtractedScheduleEvent[] = [];
  const rejectedRowsByKey = new Map<
    string,
    Omit<ExtractedScheduleRejectedRow, "index">
  >();
  const seenEventKeys = new Set<string>();

  for (const rawEntry of [...rawCandidateRows, ...rawEvents]) {
    const normalized = normalizeScheduleCandidate(rawEntry);
    if (!normalized) {
      continue;
    }

    if ("event" in normalized) {
      const eventKey = buildEventKey(normalized.event);
      if (seenEventKeys.has(eventKey)) {
        continue;
      }

      seenEventKeys.add(eventKey);
      events.push(normalized.event);
      if (events.length >= MAX_EXTRACTED_EVENTS) {
        break;
      }
      continue;
    }

    const rejectionKey = buildRejectedRowKey(normalized.rejected);
    const existing = rejectedRowsByKey.get(rejectionKey);
    if (!existing || getDraftSignalScore(normalized.rejected.draft) > getDraftSignalScore(existing.draft)) {
      rejectedRowsByKey.set(rejectionKey, {
        missing_fields: normalized.rejected.missing_fields,
        draft: normalized.rejected.draft,
      });
    }
  }

  const sourceSummary =
    typeof parsed.source_summary === "string" && parsed.source_summary.trim().length > 0
      ? parsed.source_summary.trim()
      : `Extracted schedule candidates from ${context.sourceLabel}.`;

  const confidence = confidenceSchema.safeParse(parsed.confidence);

  return {
    events,
    rejected_rows: Array.from(rejectedRowsByKey.values())
      .slice(0, MAX_REJECTED_ROWS)
      .map((row, index) => ({
        index,
        missing_fields: row.missing_fields,
        draft: row.draft,
      })),
    source_summary: sourceSummary,
    confidence: confidence.success ? confidence.data : "low",
  };
}

function normalizeScheduleCandidate(
  rawCandidate: unknown
):
  | { event: ExtractedScheduleEvent }
  | { rejected: Omit<ExtractedScheduleRejectedRow, "index"> }
  | null {
  if (!rawCandidate || typeof rawCandidate !== "object") {
    return null;
  }

  const record = rawCandidate as Record<string, unknown>;
  const draft: Record<string, unknown> = {};

  const rawText = getTrimmedStringField(record, ["raw_text", "rawText", "row_text", "text"], 500);
  if (rawText) {
    draft.raw_text = rawText;
  }

  const title = getTrimmedStringField(
    record,
    ["title", "name", "event", "opponent", "opponent_name"],
    200
  );
  if (title) {
    draft.title = title;
  }

  const startDate = normalizeDateValue(
    getTrimmedStringField(record, ["start_date", "startDate", "date"], 50)
  );
  if (startDate) {
    draft.start_date = startDate;
  }

  const startTime = normalizeTimeValue(
    getTrimmedStringField(record, ["start_time", "startTime", "time"], 50)
  );
  if (startTime) {
    draft.start_time = startTime;
  }

  const endDate = normalizeDateValue(
    getTrimmedStringField(record, ["end_date", "endDate"], 50)
  );
  if (endDate) {
    draft.end_date = endDate;
  }

  const endTime = normalizeTimeValue(
    getTrimmedStringField(record, ["end_time", "endTime"], 50)
  );
  if (endTime) {
    draft.end_time = endTime;
  }

  const location = getTrimmedStringField(record, ["location", "venue"], 500);
  if (location) {
    draft.location = location;
  }

  const description = getTrimmedStringField(record, ["description", "notes"], 5000);
  if (description) {
    draft.description = description;
  }

  const eventType = normalizeEventType(
    getTrimmedStringField(record, ["event_type", "eventType", "type"], 50)
  );
  if (eventType) {
    draft.event_type = eventType;
  }

  if (!hasMeaningfulScheduleSignal(draft)) {
    return null;
  }

  const missingFields = REQUIRED_EVENT_FIELDS.filter((field) => {
    const value = draft[field];
    return typeof value !== "string" || value.trim().length === 0;
  });

  if (missingFields.length === 0) {
    const validated = extractedScheduleEventSchema.safeParse(draft);
    if (validated.success) {
      return { event: validated.data };
    }

    return {
      rejected: {
        missing_fields: validated.error.issues.map((issue) => issue.path.join(".") || "body"),
        draft,
      },
    };
  }

  return {
    rejected: {
      missing_fields: [...missingFields],
      draft,
    },
  };
}

function getTrimmedStringField(
  record: Record<string, unknown>,
  keys: string[],
  maxLength: number
): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value !== "string") {
      continue;
    }

    const trimmed = value.trim();
    if (trimmed.length === 0) {
      continue;
    }

    return trimmed.slice(0, maxLength);
  }

  return undefined;
}

function normalizeDateValue(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  const isoMatch = value.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (isoMatch) {
    return `${isoMatch[1]}-${isoMatch[2].padStart(2, "0")}-${isoMatch[3].padStart(2, "0")}`;
  }

  const usMatch = value.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
  if (usMatch) {
    const year = usMatch[3].length === 2 ? `20${usMatch[3]}` : usMatch[3];
    return `${year}-${usMatch[1].padStart(2, "0")}-${usMatch[2].padStart(2, "0")}`;
  }

  return undefined;
}

function normalizeTimeValue(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  if (/^\d{2}:\d{2}$/.test(value)) {
    return value;
  }

  const normalized = value.replace(/\./g, ":").replace(/\s+/g, " ").trim();
  const meridiemMatch = normalized.match(/^(\d{1,2})(?::(\d{2}))?\s*([AaPp])[.]?[Mm][.]?$/);
  if (meridiemMatch) {
    let hour = Number.parseInt(meridiemMatch[1] ?? "", 10);
    const minute = meridiemMatch[2] ?? "00";
    const meridiem = (meridiemMatch[3] ?? "").toUpperCase();

    if (Number.isNaN(hour) || hour < 1 || hour > 12) {
      return undefined;
    }

    if (meridiem === "P" && hour < 12) {
      hour += 12;
    }
    if (meridiem === "A" && hour === 12) {
      hour = 0;
    }

    return `${String(hour).padStart(2, "0")}:${minute}`;
  }

  const hourMinuteMatch = normalized.match(/^(\d{1,2}):(\d{2})$/);
  if (hourMinuteMatch) {
    const hour = Number.parseInt(hourMinuteMatch[1] ?? "", 10);
    const minute = hourMinuteMatch[2] ?? "";
    if (Number.isNaN(hour) || hour < 0 || hour > 23) {
      return undefined;
    }
    return `${String(hour).padStart(2, "0")}:${minute}`;
  }

  return undefined;
}

function normalizeEventType(value: string | undefined): ExtractedScheduleEvent["event_type"] {
  if (!value) {
    return undefined;
  }

  const normalized = value.trim().toLowerCase();
  switch (normalized) {
    case "general":
    case "philanthropy":
    case "game":
    case "practice":
    case "meeting":
    case "social":
    case "workout":
    case "fundraiser":
    case "class":
      return normalized;
    default:
      return undefined;
  }
}

function hasMeaningfulScheduleSignal(draft: Record<string, unknown>): boolean {
  return getDraftSignalScore(draft) >= 2;
}

function getDraftSignalScore(draft: Record<string, unknown>): number {
  const keys = [
    "title",
    "start_date",
    "start_time",
    "end_date",
    "end_time",
    "location",
    "description",
    "event_type",
    "raw_text",
  ];

  return keys.reduce((score, key) => {
    const value = draft[key];
    return typeof value === "string" && value.trim().length > 0 ? score + 1 : score;
  }, 0);
}

function buildEventKey(event: ExtractedScheduleEvent): string {
  return [
    event.title,
    event.start_date,
    event.start_time,
    event.end_date ?? "",
    event.end_time ?? "",
    event.location ?? "",
    event.description ?? "",
    event.event_type ?? "",
  ].join("|");
}

function buildRejectedRowKey(row: Omit<ExtractedScheduleRejectedRow, "index">): string {
  const draftIdentity = [
    row.draft.title,
    row.draft.start_date,
    row.draft.start_time,
    row.draft.end_date,
    row.draft.end_time,
    row.draft.location,
    row.draft.description,
    row.draft.event_type,
  ]
    .map((value) => (typeof value === "string" ? value : ""))
    .join("|");

  const fallbackIdentity =
    draftIdentity.replace(/\|/g, "").length > 0
      ? draftIdentity
      : typeof row.draft.raw_text === "string"
      ? row.draft.raw_text
      : JSON.stringify(row.draft);

  return `${fallbackIdentity}::${row.missing_fields.join(",")}`;
}

function normalizeJsonText(value: string): string {
  const trimmed = value.trim();

  if (trimmed.startsWith("```")) {
    return trimmed.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
  }

  return trimmed;
}

function supportsPromptOnlyJsonFallback(error: unknown): boolean {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "object" && error !== null && "message" in error
      ? String(error.message)
      : "";

  return /response_format|json_object|unsupported/i.test(message);
}
