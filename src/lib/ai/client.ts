import OpenAI from "openai";

const DEFAULT_ZAI_MODEL = "glm-5.1";
const DEFAULT_ZAI_IMAGE_MODEL = "glm-5v-turbo";

function validateZaiImageModel(value: string): string {
  const normalized = value.trim();

  if (normalized.length === 0) {
    return DEFAULT_ZAI_IMAGE_MODEL;
  }

  if (!normalized.startsWith("glm-")) {
    throw new Error(
      `Invalid ZAI_IMAGE_MODEL value "${normalized}". Expected a Z.AI vision model such as ${DEFAULT_ZAI_IMAGE_MODEL}.`
    );
  }

  return normalized;
}

export function createZaiClient(): OpenAI {
  const apiKey = process.env.ZAI_API_KEY;
  if (!apiKey) {
    throw new Error("ZAI_API_KEY environment variable is required for AI assistant features");
  }

  return new OpenAI({
    apiKey,
    baseURL: "https://api.z.ai/api/paas/v4",
  });
}

export function getZaiModel(): string {
  return process.env.ZAI_MODEL || DEFAULT_ZAI_MODEL;
}

export function getZaiImageModel(): string {
  return validateZaiImageModel(process.env.ZAI_IMAGE_MODEL || DEFAULT_ZAI_IMAGE_MODEL);
}
