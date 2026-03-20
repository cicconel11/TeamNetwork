import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { ThreadList } from "../src/components/ai-assistant/ThreadList.tsx";

describe("ThreadList date rendering", () => {
  it("renders thread dates deterministically across timezone boundaries", () => {
    const html = renderToStaticMarkup(
      createElement(ThreadList, {
        threads: [
          {
            id: "thread-1",
            title: "Planning",
            surface: "general",
            updated_at: "2026-03-01T00:30:00.000Z",
          },
        ],
        loading: false,
        activeThreadId: null,
        onSelectThread: () => {},
        onNewThread: () => {},
        onDeleteThread: async () => {},
      })
    );

    assert.match(html, /Mar 1, 2026/);
  });
});
