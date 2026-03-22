import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { MessageList } from "../src/components/ai-assistant/MessageList.tsx";

const baseMessage = {
  status: "complete",
  created_at: "2026-03-20T00:00:00Z",
} as const;

describe("MessageList assistant rendering", () => {
  it("renders assistant markdown while keeping user text literal", () => {
    const html = renderToStaticMarkup(
      createElement(MessageList, {
        loading: false,
        messages: [
          {
            ...baseMessage,
            id: "assistant-1",
            role: "assistant",
            content: "Paragraph\n\n- first item\n- second item",
          },
          {
            ...baseMessage,
            id: "user-1",
            role: "user",
            content: "**literal user markdown**",
          },
        ],
      })
    );

    assert.match(html, /<ul/);
    assert.match(html, /<li[^>]*>first item<\/li>/);
    assert.match(html, /\*\*literal user markdown\*\*/);
  });

  it("does not render raw HTML from assistant content", () => {
    const html = renderToStaticMarkup(
      createElement(MessageList, {
        loading: false,
        messages: [
          {
            ...baseMessage,
            id: "assistant-1",
            role: "assistant",
            content: "<img src=x onerror=alert(1) />",
          },
        ],
      })
    );

    assert.ok(!html.includes("<img"));
    assert.match(html, /&lt;img src=x onerror=alert\(1\) \/&gt;/);
  });

  it("renders streaming content through AssistantMessageContent", () => {
    const html = renderToStaticMarkup(
      createElement(MessageList, {
        loading: false,
        messages: [],
        isStreaming: true,
        streamingContent: "**bold text**",
      })
    );

    assert.match(html, /<strong>bold text<\/strong>/);
    assert.ok(!html.includes("whitespace-pre-wrap"), "streaming should not use plain-text wrapper");
  });

  it("keeps a completed assistant preview visible while the persisted message is still refreshing", () => {
    const html = renderToStaticMarkup(
      createElement(MessageList, {
        loading: false,
        messages: [],
        isStreaming: false,
        previewAssistantContent: "**final answer**",
        previewAssistantStreaming: false,
      })
    );

    assert.match(html, /<strong>final answer<\/strong>/);
  });

  it("does not duplicate the assistant preview once the persisted assistant message is present", () => {
    const html = renderToStaticMarkup(
      createElement(MessageList, {
        loading: false,
        messages: [
          {
            ...baseMessage,
            id: "assistant-1",
            role: "assistant",
            content: "final answer",
          },
        ],
        previewAssistantContent: "final answer",
        previewAssistantStreaming: false,
      })
    );

    const matches = html.match(/final answer/g) ?? [];
    assert.equal(matches.length, 1);
  });
});
