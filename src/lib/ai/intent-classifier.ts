import type OpenAI from "openai";
import { getZaiModel } from "./client";

export type AiIntent = "analysis" | "faq" | "action" | "general";

export interface IntentClassification {
  intent: AiIntent;
  confidence: number;
}

const VALID_INTENTS: Set<string> = new Set(["analysis", "faq", "action", "general"]);

export async function classifyIntent(
  message: string,
  client: OpenAI
): Promise<IntentClassification> {
  try {
    const response = await client.chat.completions.create({
      model: getZaiModel(),
      messages: [
        {
          role: "system",
          content: [
            "Classify the user message into one of these intents:",
            "- analysis: Questions about org data, stats, members, events, trends",
            "- faq: Questions about how the platform works, features, policies",
            "- action: Requests to change data, send messages, update settings",
            "- general: Greetings, small talk, unclear intent, meta questions",
            "",
            'Respond with JSON: { "intent": "<intent>", "confidence": <0-1> }',
          ].join("\n"),
        },
        { role: "user", content: message },
      ],
      response_format: { type: "json_object" },
      temperature: 0,
      max_tokens: 100,
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      return { intent: "general", confidence: 0 };
    }

    const parsed = JSON.parse(content);
    const intent = VALID_INTENTS.has(parsed.intent) ? (parsed.intent as AiIntent) : "general";
    const confidence =
      typeof parsed.confidence === "number" ? Math.min(1, Math.max(0, parsed.confidence)) : 0;

    return { intent, confidence };
  } catch (err) {
    console.error("[intent-classifier] classification failed:", err);
    return { intent: "general", confidence: 0 };
  }
}
