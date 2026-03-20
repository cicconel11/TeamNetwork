import OpenAI from "openai";

export function createZaiClient(): OpenAI {
  const apiKey = process.env.ZAI_API_KEY;
  if (!apiKey) {
    throw new Error("ZAI_API_KEY environment variable is required for AI assistant features");
  }

  return new OpenAI({
    apiKey,
    baseURL: "https://api.x.ai/v1",
  });
}

export function getZaiModel(): string {
  return process.env.ZAI_MODEL || "grok-3-mini";
}
