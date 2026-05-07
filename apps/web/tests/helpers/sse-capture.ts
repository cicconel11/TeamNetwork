/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * SSE snapshot capture helper.
 *
 * Drains a streamed Response from createChatPostHandler, normalizes
 * non-deterministic surface area (timestamps, dynamic IDs we cannot
 * pin via stubs), and renders stable snapshot text.
 *
 * Snapshot format (text):
 *   STATUS <status>
 *   HEADER content-type: <value>
 *   HEADER x-ai-thread-id: <value>
 *   ---BODY---
 *   <SSE text, line-normalized>
 */

import * as fs from "node:fs";
import * as path from "node:path";

const ISO_TS_RE = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/g;
const ISO_TS_NO_MS_RE = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z/g;

const HEADERS_OF_INTEREST = [
  "content-type",
  "x-ai-thread-id",
] as const;

export interface CapturedSse {
  status: number;
  headers: Record<string, string | null>;
  body: string;
}

export async function captureSse(response: Response): Promise<CapturedSse> {
  const headers: Record<string, string | null> = {};
  for (const name of HEADERS_OF_INTEREST) {
    headers[name] = response.headers.get(name);
  }
  const raw = await response.text();
  return {
    status: response.status,
    headers,
    body: normalizeBody(raw),
  };
}

export function normalizeBody(raw: string): string {
  return raw
    .replace(ISO_TS_RE, "<TS>")
    .replace(ISO_TS_NO_MS_RE, "<TS>");
}

export function renderSnapshot(captured: CapturedSse): string {
  const lines: string[] = [];
  lines.push(`STATUS ${captured.status}`);
  for (const name of HEADERS_OF_INTEREST) {
    const value = captured.headers[name];
    lines.push(`HEADER ${name}: ${value === null ? "<null>" : value}`);
  }
  lines.push("---BODY---");
  lines.push(captured.body);
  return lines.join("\n");
}

const FIXTURE_ROOT = path.resolve(
  // tests/helpers/sse-capture.ts -> ../fixtures/handler-sse/
  new URL("../fixtures/handler-sse/", import.meta.url).pathname
);

export function fixturePath(name: string): string {
  return path.join(FIXTURE_ROOT, `${name}.snap`);
}

export function readSnapshot(name: string): string | null {
  const p = fixturePath(name);
  if (!fs.existsSync(p)) return null;
  return fs.readFileSync(p, "utf8");
}

export function writeSnapshot(name: string, content: string): void {
  const p = fixturePath(name);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content, "utf8");
}

export function shouldUpdate(): boolean {
  return process.env.UPDATE_SNAPSHOTS === "1";
}
