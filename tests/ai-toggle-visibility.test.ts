import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { AIPanelProvider } from "../src/components/ai-assistant/AIPanelContext.tsx";
import { AIAssistantToggle } from "../src/components/ai-assistant/AIAssistantToggle.tsx";

describe("AIAssistantToggle", () => {
  it("renders a visible desktop label for admin users", () => {
    const html = renderToStaticMarkup(
      createElement(
        AIPanelProvider,
        null,
        createElement(AIAssistantToggle, { isAdmin: true, showLabel: true })
      )
    );

    assert.match(html, /AI Assistant/);
  });

  it("renders nothing for non-admin users", () => {
    const html = renderToStaticMarkup(
      createElement(
        AIPanelProvider,
        null,
        createElement(AIAssistantToggle, { isAdmin: false, showLabel: true })
      )
    );

    assert.equal(html, "");
  });
});
