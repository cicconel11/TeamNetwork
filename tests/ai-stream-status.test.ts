import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { consumeSSEStream } from "../src/hooks/useAIStream.ts";
import {
  deriveToolStatusLabel,
  formatToolStatusLabel,
} from "../src/components/ai-assistant/tool-status.ts";
import { MessageInput } from "../src/components/ai-assistant/MessageInput.tsx";

const REPO_ROOT = process.cwd();

function readSource(relativePath: string): string {
  return fs.readFileSync(path.join(REPO_ROOT, relativePath), "utf8");
}

function makeSSEEventStream(events: unknown[]): Response {
  const encoder = new TextEncoder();

  return new Response(
    new ReadableStream({
      start(controller) {
        for (const event of events) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        }
        controller.close();
      },
    }),
    {
      headers: { "Content-Type": "text/event-stream" },
    }
  );
}

test("formatToolStatusLabel maps known tools and falls back safely", () => {
  assert.equal(formatToolStatusLabel("list_members"), "Looking up members...");
  assert.equal(formatToolStatusLabel("list_events"), "Looking up events...");
  assert.equal(formatToolStatusLabel("get_org_stats"), "Checking organization stats...");
  assert.equal(formatToolStatusLabel("suggest_connections"), "Finding connections...");
  assert.equal(formatToolStatusLabel("future_tool"), "Working...");
});

test("deriveToolStatusLabel only updates on calling events", () => {
  assert.equal(
    deriveToolStatusLabel(null, {
      type: "tool_status",
      toolName: "list_members",
      status: "calling",
    }),
    "Looking up members..."
  );

  assert.equal(
    deriveToolStatusLabel("Looking up members...", {
      type: "tool_status",
      toolName: "list_members",
      status: "done",
    }),
    "Looking up members..."
  );

  assert.equal(
    deriveToolStatusLabel("Looking up members...", {
      type: "tool_status",
      toolName: "list_members",
      status: "error",
    }),
    "Looking up members..."
  );
});

test("consumeSSEStream forwards tool_status events and still returns final content", async () => {
  const toolEvents: Array<{ toolName: string; status: string }> = [];
  const chunks: string[] = [];

  const result = await consumeSSEStream(
    makeSSEEventStream([
      { type: "tool_status", toolName: "list_members", status: "calling" },
      { type: "chunk", content: "Here are " },
      { type: "tool_status", toolName: "list_members", status: "done" },
      { type: "chunk", content: "5 members." },
      { type: "done", threadId: "thread-123" },
    ]),
    {
      onToolStatus: (event) => {
        toolEvents.push({ toolName: event.toolName, status: event.status });
      },
      onChunk: (content) => {
        chunks.push(content);
      },
    }
  );

  assert.deepEqual(toolEvents, [
    { toolName: "list_members", status: "calling" },
    { toolName: "list_members", status: "done" },
  ]);
  assert.deepEqual(chunks, ["Here are ", "5 members."]);
  assert.deepEqual(result, {
    threadId: "thread-123",
    content: "Here are 5 members.",
    replayed: undefined,
    usage: undefined,
  });
});

test("MessageInput renders tool status label when provided", () => {
  const html = renderToStaticMarkup(
    React.createElement(MessageInput, {
      isStreaming: true,
      error: null,
      toolStatusLabel: "Finding connections...",
      onSend: async () => {},
      onCancel: () => {},
      onClearError: () => {},
    })
  );

  assert.match(html, /Finding connections\.\.\./);
  assert.doesNotMatch(html, />Thinking\.\.\.</);
});

test("useAIStream resets tool status during key lifecycle transitions", () => {
  const source = readSource("src/hooks/useAIStream.ts");

  assert.match(
    source,
    /setState\(prev => \(\{ \.\.\.prev, isStreaming: false, toolStatusLabel: null \}\)\);/,
    "cancel should clear tool status"
  );
  assert.match(
    source,
    /setState\(\{\s*isStreaming: true,\s*error: null,\s*currentContent: \"\",\s*threadId: opts\.threadId \?\? null,\s*toolStatusLabel: null,\s*\}\);/s,
    "new requests should start with a cleared tool status"
  );
  assert.match(
    source,
    /threadId: failure\.result\?\.threadId \?\? prev\.threadId,\s*error: failure\.error,\s*toolStatusLabel: null,/s,
    "HTTP failures should clear tool status"
  );
  assert.match(
    source,
    /threadId: event\.threadId,\s*toolStatusLabel: null,/s,
    "done events should clear tool status"
  );
  assert.match(
    source,
    /error: messageText,\s*toolStatusLabel: null,/s,
    "stream errors should clear tool status"
  );
  assert.match(
    source,
    /error: err instanceof Error \? err\.message : \"Unknown error\",\s*toolStatusLabel: null,/s,
    "unexpected errors should clear tool status"
  );
});
