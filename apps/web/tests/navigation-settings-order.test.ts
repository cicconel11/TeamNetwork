import test from "node:test";
import assert from "node:assert/strict";
import { getSettingsGroupKey, reorderItemWithinGroup } from "@/lib/navigation/navigation-settings-order";

type Item = {
  href: string;
  group?: "people" | "community" | "schedule" | "activity" | "finance" | "admin";
};

test("getSettingsGroupKey separates dashboard and standalone", () => {
  assert.equal(getSettingsGroupKey({ href: "" }), "dashboard");
  assert.equal(getSettingsGroupKey({ href: "/jobs" }), "standalone");
  assert.equal(getSettingsGroupKey({ href: "/members", group: "people" }), "people");
});

test("reorderItemWithinGroup does not move dashboard when reordering standalone", () => {
  const items: Item[] = [
    { href: "" }, // dashboard
    { href: "/jobs" }, // standalone
    { href: "/media" }, // standalone
    { href: "/members", group: "people" },
  ];

  const reordered = reorderItemWithinGroup(items, "/media", "up");
  assert.deepEqual(reordered.map((item) => item.href), ["", "/media", "/jobs", "/members"]);
});

test("reorderItemWithinGroup respects group boundaries", () => {
  const items: Item[] = [
    { href: "" },
    { href: "/chat", group: "community" },
    { href: "/feed", group: "community" },
    { href: "/jobs" },
  ];

  const reordered = reorderItemWithinGroup(items, "/feed", "down");
  assert.deepEqual(
    reordered.map((item) => item.href),
    ["", "/chat", "/feed", "/jobs"],
    "community item should not move into standalone section",
  );
});
