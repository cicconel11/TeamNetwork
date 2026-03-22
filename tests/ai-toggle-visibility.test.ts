import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { AIPanelProvider } from "../src/components/ai-assistant/AIPanelContext.tsx";
import { AIEdgeTab } from "../src/components/ai-assistant/AIEdgeTab.tsx";

describe("AIEdgeTab", () => {
  it("renders a button for admin users", () => {
    const html = renderToStaticMarkup(
      createElement(
        AIPanelProvider,
        null,
        createElement(AIEdgeTab, { isAdmin: true })
      )
    );

    assert.match(html, /<button/);
    assert.match(html, /ai-edge-tab/);
    assert.match(html, /AI/);
  });

  it("renders nothing for non-admin users", () => {
    const html = renderToStaticMarkup(
      createElement(
        AIPanelProvider,
        null,
        createElement(AIEdgeTab, { isAdmin: false })
      )
    );

    assert.equal(html, "");
  });
});

describe("AIAssistantToggle removal", () => {
  it("OrgSidebar no longer references AIAssistantToggle", () => {
    const source = readFileSync(
      resolve("src/components/layout/OrgSidebar.tsx"),
      "utf-8"
    );
    assert.ok(
      !source.includes("AIAssistantToggle"),
      "OrgSidebar.tsx still references AIAssistantToggle"
    );
  });

  it("MobileNav no longer references AIAssistantToggle", () => {
    const source = readFileSync(
      resolve("src/components/layout/MobileNav.tsx"),
      "utf-8"
    );
    assert.ok(
      !source.includes("AIAssistantToggle"),
      "MobileNav.tsx still references AIAssistantToggle"
    );
  });
});
