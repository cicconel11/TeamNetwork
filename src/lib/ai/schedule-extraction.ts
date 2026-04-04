import type OpenAI from "openai";
import { z } from "zod";
import { createZaiClient, getZaiImageModel, getZaiModel } from "@/lib/ai/client";

const MAX_SOURCE_TEXT_CHARS = 12_000;
const MAX_EXTRACTED_EVENTS = 25;
const MAX_REJECTED_ROWS = 25;
const REQUIRED_EVENT_FIELDS = ["title", "start_date", "start_time"] as const;
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
  const truncatedText = text.slice(0, MAX_SOURCE_TEXT_CHARS);
  if (truncatedText.trim().length === 0) {
    return {
      events: [],
      rejected_rows: [],
      source_summary: `No usable text found in ${context.sourceLabel}.`,
      confidence: "low",
    };
  }

  const deps = getScheduleExtractionDeps();
  const client = deps.createClient();

  const messages = buildTextMessages(truncatedText, context);

  const initialResponse = await requestExtraction({
    client,
    model: deps.getTextModel(),
    messages,
    temperature: 0.2,
  });

  try {
    return parseExtractionResponse(initialResponse, context);
  } catch (error) {
    if (!(error instanceof SyntaxError)) {
      throw error;
    }

    const retryResponse = await requestExtraction({
      client,
      model: deps.getTextModel(),
      messages,
      temperature: 0,
    });

    return parseExtractionResponse(retryResponse, context);
  }
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
