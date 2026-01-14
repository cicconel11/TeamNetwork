import { createHash } from "crypto";
import type { TelemetryErrorEvent, FingerprintResult } from "./types";

const MAX_TITLE_LENGTH = 80;
const FINGERPRINT_LENGTH = 16;

const UUID_PATTERN = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const LONG_ID_PATTERN = /\b\d{5,}\b/g;
const HEX_STRING_PATTERN = /\b[0-9a-f]{32,}\b/gi;
const ISO_TIMESTAMP_PATTERN = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?/g;

export function normalizeErrorMessage(message: string): string {
  return message
    .replace(UUID_PATTERN, "<UUID>")
    .replace(HEX_STRING_PATTERN, "<HEX>")
    .replace(ISO_TIMESTAMP_PATTERN, "<TIMESTAMP>")
    .replace(LONG_ID_PATTERN, "<ID>")
    .replace(/\s+/g, " ")
    .trim();
}

export function extractTopStackFrame(stack: string | undefined): string | null {
  if (!stack) return null;

  const lines = stack.split("\n");

  for (const line of lines) {
    const trimmed = line.trim();

    if (!trimmed.startsWith("at ")) continue;

    if (trimmed.includes("node_modules")) continue;
    if (trimmed.includes("node:internal")) continue;
    if (trimmed.includes("<anonymous>")) continue;

    const match = trimmed.match(/at\s+(?:[\w.<>]+\s+)?\(?(.+?):\d+:\d+\)?$/);
    if (match) {
      let filePath = match[1];
      const srcIndex = filePath.indexOf("/src/");
      if (srcIndex !== -1) {
        filePath = filePath.slice(srcIndex);
      }
      return filePath;
    }

    const simpleMatch = trimmed.match(/at\s+(.+)/);
    if (simpleMatch) {
      return simpleMatch[1];
    }
  }

  return null;
}

export function generateFingerprint(event: TelemetryErrorEvent): FingerprintResult {
  const normalizedMessage = normalizeErrorMessage(event.message);
  const topFrame = extractTopStackFrame(event.stack);
  const errorName = event.name || "Error";

  const components = [
    errorName,
    normalizedMessage,
    topFrame || "",
    event.route || "",
  ];

  const hash = createHash("sha256")
    .update(components.join("|"))
    .digest("hex");

  const fingerprint = hash.slice(0, FINGERPRINT_LENGTH);

  let title = `${errorName}: ${normalizedMessage}`;
  if (title.length > MAX_TITLE_LENGTH) {
    title = title.slice(0, MAX_TITLE_LENGTH - 3) + "...";
  }

  return {
    fingerprint,
    title,
    normalizedMessage,
    topFrame,
  };
}
