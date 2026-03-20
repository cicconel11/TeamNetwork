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

  it("keeps streaming content as safe plain text", () => {
    const html = renderToStaticMarkup(
      createElement(MessageList, {
        loading: false,
        messages: [],
        isStreaming: true,
        streamingContent: "```ts\nconst x = 1\n",
      })
    );

    assert.match(html, /```ts/);
    assert.ok(!html.includes("<pre"));
    assert.match(html, /whitespace-pre-wrap/);
  });
});
