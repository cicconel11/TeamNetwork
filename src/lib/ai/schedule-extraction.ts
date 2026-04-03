import type OpenAI from "openai";
import { z } from "zod";
import { createZaiClient, getZaiImageModel, getZaiModel } from "@/lib/ai/client";

const MAX_SOURCE_TEXT_CHARS = 12_000;
const MAX_EXTRACTED_EVENTS = 25;
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
  event_type?: "general" | "philanthropy" | "game" | "meeting" | "social" | "fundraiser";
}

export interface ScheduleExtractionResult {
  events: ExtractedScheduleEvent[];
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
    .enum(["general", "philanthropy", "game", "meeting", "social", "fundraiser"])
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
    "Return only a single JSON object with keys: events, source_summary, confidence.",
    "Each event must use YYYY-MM-DD for dates and HH:MM 24-hour time for times.",
    "Only include events that are explicitly present or strongly implied by the source.",
    "Resolve relative dates against the provided current timestamp.",
    "If a required event field is missing or ambiguous, omit that event instead of inventing values.",
    "Valid event_type values are general, philanthropy, game, meeting, social, fundraiser.",
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
  context: { sourceLabel: string }
): ScheduleExtractionResult {
  const normalizedJson = normalizeJsonText(rawResponse);
  const parsed = JSON.parse(normalizedJson) as Record<string, unknown>;

  const rawEvents = Array.isArray(parsed.events) ? parsed.events : [];
  const events: ExtractedScheduleEvent[] = [];

  for (const rawEvent of rawEvents) {
    const validated = extractedScheduleEventSchema.safeParse(rawEvent);
    if (!validated.success) {
      continue;
    }
    events.push(validated.data);
    if (events.length >= MAX_EXTRACTED_EVENTS) {
      break;
    }
  }

  const sourceSummary =
    typeof parsed.source_summary === "string" && parsed.source_summary.trim().length > 0
      ? parsed.source_summary.trim()
      : `Extracted schedule candidates from ${context.sourceLabel}.`;

  const confidence = confidenceSchema.safeParse(parsed.confidence);

  return {
    events,
    source_summary: sourceSummary,
    confidence: confidence.success ? confidence.data : "low",
  };
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
