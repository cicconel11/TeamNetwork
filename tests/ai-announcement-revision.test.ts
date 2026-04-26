import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  extractAnnouncementRevisionOverrides,
  isAnnouncementRevisionMessage,
  mergeDraftPayload,
} from "../src/app/api/ai/[orgId]/chat/handler/draft-session.ts";

describe("isAnnouncementRevisionMessage", () => {
  it("detects 'change the title' as revision", () => {
    assert.equal(
      isAnnouncementRevisionMessage('change the title to "Spring Fling Updates"'),
      true
    );
  });

  it("detects 'actually' as revision", () => {
    assert.equal(
      isAnnouncementRevisionMessage("actually, make it about volunteer day"),
      true
    );
  });

  it("does not flag unrelated text as revision", () => {
    assert.equal(isAnnouncementRevisionMessage("hello"), false);
  });
});

describe("extractAnnouncementRevisionOverrides — title-only revision", () => {
  it("returns only title when user revises title", () => {
    const overrides = extractAnnouncementRevisionOverrides(
      'change the title to "Spring Fling Updates"'
    );
    assert.deepEqual(overrides, { title: "Spring Fling Updates" });
    assert.equal("body" in overrides, false);
  });

  it("supports rename verb", () => {
    const overrides = extractAnnouncementRevisionOverrides(
      "rename title to Welcome Week"
    );
    assert.equal(overrides.title, "Welcome Week");
    assert.equal("body" in overrides, false);
  });

  it("supports 'title should be' phrasing", () => {
    const overrides = extractAnnouncementRevisionOverrides(
      'title should be "New Members Mixer".'
    );
    assert.equal(overrides.title, "New Members Mixer");
  });
});

describe("extractAnnouncementRevisionOverrides — body-only revision", () => {
  it("extracts body when user revises body explicitly", () => {
    const overrides = extractAnnouncementRevisionOverrides(
      "rewrite the body to: Practice moved to 6pm tomorrow."
    );
    assert.equal(overrides.body, "Practice moved to 6pm tomorrow");
    assert.equal("title" in overrides, false);
  });
});

describe("extractAnnouncementRevisionOverrides — structured fields", () => {
  it("parses structured 'title:' / 'body:' lines", () => {
    const overrides = extractAnnouncementRevisionOverrides(
      "title: Spring Fling\nbody: Join us Saturday."
    );
    assert.equal(overrides.title, "Spring Fling");
    assert.equal(overrides.body, "Join us Saturday.");
  });

  it("parses audience override", () => {
    const overrides = extractAnnouncementRevisionOverrides(
      "change the title to Reunion\naudience: alumni"
    );
    assert.equal(overrides.audience, "alumni");
    assert.equal(overrides.title, "Reunion");
  });
});

describe("mergeDraftPayload preserves base body when revision only touches title", () => {
  it("keeps prior body when override only has title", () => {
    const base = {
      title: "Practice Cancelled",
      body: "Practice on Tuesday is cancelled due to rain. Backup plan: film session in the team room.",
      audience: "members",
    };
    const overrides = extractAnnouncementRevisionOverrides(
      'change the title to "Practice Update"'
    );
    const merged = mergeDraftPayload(base, overrides);
    assert.equal(merged.title, "Practice Update");
    assert.equal(merged.body, base.body, "body should fall through from base");
    assert.equal(merged.audience, "members");
  });
});
