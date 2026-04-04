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
  assert.equal(formatToolStatusLabel("list_announcements"), "Looking up announcements...");
  assert.equal(formatToolStatusLabel("list_discussions"), "Looking up discussions...");
  assert.equal(formatToolStatusLabel("list_job_postings"), "Looking up job postings...");
  assert.equal(formatToolStatusLabel("prepare_job_posting"), "Preparing job posting...");
  assert.equal(formatToolStatusLabel("prepare_discussion_thread"), "Preparing discussion thread...");
  assert.equal(formatToolStatusLabel("get_org_stats"), "Checking organization stats...");
  assert.equal(formatToolStatusLabel("suggest_connections"), "Finding connections...");
  assert.equal(formatToolStatusLabel("find_navigation_targets"), "Finding the right page...");
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

test("consumeSSEStream forwards pending_action events before completion", async () => {
  const pendingActions: Array<{ actionId: string; actionType: string }> = [];

  await consumeSSEStream(
    makeSSEEventStream([
      {
        type: "pending_action",
        actionId: "action-123",
        actionType: "create_job_posting",
        summary: { title: "Review job posting", description: "Confirm it" },
        payload: { title: "Senior Product Designer" },
        expiresAt: "2026-07-27T00:15:00.000Z",
      },
      { type: "done", threadId: "thread-123" },
    ]),
    {
      onPendingAction: (event) => {
        pendingActions.push({ actionId: event.actionId, actionType: event.actionType });
      },
    }
  );

  assert.deepEqual(pendingActions, [
    { actionId: "action-123", actionType: "create_job_posting" },
  ]);
});

test("MessageInput renders tool status label when provided", () => {
  const html = renderToStaticMarkup(
    React.createElement(MessageInput, {
      input: "Show me members",
      isStreaming: true,
      error: null,
      toolStatusLabel: "Finding connections...",
      onInputChange: () => {},
      onSend: async () => {},
      onAttachFile: async () => {},
      onRemoveAttachment: () => {},
      onCancel: () => {},
      onClearError: () => {},
    })
  );

  assert.match(html, /Finding connections\.\.\./);
  assert.doesNotMatch(html, />Thinking\.\.\.</);
});

test("MessageInput renders attached schedule image state, generic labels, and upload errors", () => {
  const html = renderToStaticMarkup(
    React.createElement(MessageInput, {
      input: "Please extract this schedule file and prepare events for confirmation.",
      isStreaming: false,
      isUploadingAttachment: false,
      error: null,
      attachmentError: "File must be a PDF or image",
      attachment: {
        storagePath: "org-1/user-1/schedule.png",
        fileName: "varsity-schedule.png",
        mimeType: "image/png",
      },
      onInputChange: () => {},
      onSend: async () => {},
      onAttachFile: async () => {},
      onRemoveAttachment: () => {},
      onCancel: () => {},
      onClearError: () => {},
    })
  );

  assert.match(html, /varsity-schedule\.png/);
  assert.match(html, /Remove attached schedule file/);
  assert.match(html, /Replace attached schedule file/);
  assert.match(html, /accept="\.pdf,\.png,\.jpg,\.jpeg,application\/pdf,image\/png,image\/jpeg,image\/jpg"/);
  assert.match(html, /File must be a PDF or image/);
});

test("MessageInput renders generic uploading copy for schedule files", () => {
  const html = renderToStaticMarkup(
    React.createElement(MessageInput, {
      input: "",
      isStreaming: false,
      isUploadingAttachment: true,
      error: null,
      onInputChange: () => {},
      onSend: async () => {},
      onAttachFile: async () => {},
      onRemoveAttachment: () => {},
      onCancel: () => {},
      onClearError: () => {},
    })
  );

  assert.match(html, /Uploading schedule file\.\.\./);
});

test("AIPanel uses generic schedule file defaults and preserves uploaded mime types", () => {
  const source = readSource("src/components/ai-assistant/AIPanel.tsx");

  assert.match(
    source,
    /const DEFAULT_SCHEDULE_FILE_PROMPT =\s*"Please extract this schedule file and prepare events for confirmation\.";/,
    "AIPanel should use the generic schedule-file prompt"
  );
  assert.match(
    source,
    /mimeType: data\.mimeType,/,
    "AIPanel should preserve the uploaded mimeType returned by the server"
  );
  assert.match(
    source,
    /setAttachmentError\(data\.error \|\| "Failed to upload schedule file\."\);/,
    "AIPanel should use generic upload fallback copy"
  );
  assert.match(
    source,
    /error instanceof Error \? error\.message : "Failed to upload schedule file\."/,
    "AIPanel should keep generic upload failure copy in the catch path"
  );
  assert.match(
    source,
    /fetch\(`\/api\/ai\/\$\{orgId\}\/upload-schedule`, \{\s*method: "DELETE"/,
    "AIPanel should delete pending schedule uploads when attachments are cleared"
  );
  assert.match(
    source,
    /clearAttachment\(\{ deleteRemote: false \}\);/,
    "AIPanel should leave extractor-owned attachments alone after a successful send"
  );
  assert.match(
    source,
    /const router = useRouter\(\);/,
    "AIPanel should capture the Next router so confirmation can refresh server-rendered calendar views"
  );
  assert.match(
    source,
    /router\.refresh\(\);/,
    "AIPanel should refresh the current route after confirming a pending action"
  );
  assert.match(
    source,
    /import \{ prepareImageUpload \} from "@\/lib\/media\/image-preparation";/,
    "AIPanel should reuse the existing browser image preparation pipeline for schedule photos"
  );
  assert.match(
    source,
    /const normalizedFile = await normalizeScheduleUploadFile\(file\);/,
    "AIPanel should normalize schedule image uploads before posting them to the server"
  );
  assert.match(
    source,
    /formData\.set\("file", normalizedFile\);/,
    "AIPanel should upload the normalized schedule image file"
  );
  assert.match(
    source,
    /That schedule image is too large to process\. Please upload an image under 2MB or use a PDF instead\./,
    "AIPanel should fail fast when a normalized schedule image still exceeds the extractor budget"
  );
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
    /responseThreadId = response\.headers\.get\("x-ai-thread-id"\) \?\? responseThreadId;/,
    "successful responses should capture the server thread id header for reload recovery"
  );
  assert.match(
    source,
    /return \{ threadId: responseThreadId, interrupted: true \};/,
    "aborted requests should preserve the known thread id when available"
  );
  assert.match(
    source,
    /setState\(\{\s*isStreaming: true,\s*error: null,\s*currentContent: \"\",\s*threadId: opts\.threadId \?\? null,\s*toolStatusLabel: null,\s*pendingActions: \[\],\s*\}\);/s,
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
  assert.match(
    source,
    /attachment: opts\.attachment,/,
    "chat requests should include attachment metadata when provided"
  );
});
