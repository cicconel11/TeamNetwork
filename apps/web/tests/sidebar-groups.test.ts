/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  bucketItemsByGroup,
  getActiveGroup,
  buildSectionOrder,
  buildGlobalIndexMap,
  type VisibleNavItem,
} from "../src/lib/navigation/sidebar-groups";
import { ORG_NAV_GROUPS } from "../src/lib/navigation/nav-items";

// Minimal stub icon component for test items
const StubIcon = () => null;

function makeItem(overrides: Partial<VisibleNavItem> & { href: string; label: string }): VisibleNavItem {
  return {
    icon: StubIcon as any,
    roles: ["admin", "active_member", "alumni", "parent"],
    ...overrides,
  };
}

describe("bucketItemsByGroup", () => {
  it("buckets dashboard item separately", () => {
    const items = [
      makeItem({ href: "", label: "Dashboard" }),
      makeItem({ href: "/members", label: "Members", group: "people" }),
    ];
    const buckets = bucketItemsByGroup(items);
    assert.equal(buckets.get("dashboard")?.length, 1);
    assert.equal(buckets.get("dashboard")?.[0].href, "");
    assert.equal(buckets.get("people")?.length, 1);
  });

  it("buckets community-grouped items into community bucket", () => {
    const items = [
      makeItem({ href: "/jobs", label: "Jobs", group: "community" }),
      makeItem({ href: "/media", label: "Media Archive", group: "community" }),
    ];
    const buckets = bucketItemsByGroup(items);
    assert.equal(buckets.get("community")?.length, 2);
    assert.equal(buckets.has("standalone"), false);
    assert.equal(buckets.has("people"), false);
  });

  it("groups items by their group field", () => {
    const items = [
      makeItem({ href: "/members", label: "Members", group: "people" }),
      makeItem({ href: "/alumni", label: "Alumni", group: "people" }),
      makeItem({ href: "/events", label: "Events", group: "schedule" }),
      makeItem({ href: "/workouts", label: "Workouts", group: "activity" }),
    ];
    const buckets = bucketItemsByGroup(items);
    assert.equal(buckets.get("people")?.length, 2);
    assert.equal(buckets.get("schedule")?.length, 1);
    assert.equal(buckets.get("activity")?.length, 1);
  });

  it("preserves item order within each bucket", () => {
    const items = [
      makeItem({ href: "/members", label: "Members", group: "people" }),
      makeItem({ href: "/alumni", label: "Alumni", group: "people" }),
      makeItem({ href: "/mentorship", label: "Mentorship", group: "people" }),
    ];
    const buckets = bucketItemsByGroup(items);
    const people = buckets.get("people")!;
    assert.equal(people[0].href, "/members");
    assert.equal(people[1].href, "/alumni");
    assert.equal(people[2].href, "/mentorship");
  });
});

describe("getActiveGroup", () => {
  const items = [
    makeItem({ href: "", label: "Dashboard" }),
    makeItem({ href: "/members", label: "Members", group: "people" }),
    makeItem({ href: "/events", label: "Events", group: "schedule" }),
    makeItem({ href: "/workouts", label: "Workouts", group: "activity" }),
    makeItem({ href: "/jobs", label: "Jobs", group: "community" }),
  ];

  it("returns group for exact match", () => {
    assert.equal(getActiveGroup("/org/members", "/org", items), "people");
    assert.equal(getActiveGroup("/org/events", "/org", items), "schedule");
  });

  it("returns group for nested path match", () => {
    assert.equal(getActiveGroup("/org/members/123", "/org", items), "people");
    assert.equal(getActiveGroup("/org/events/new", "/org", items), "schedule");
  });

  it("returns null for dashboard", () => {
    assert.equal(getActiveGroup("/org", "/org", items), null);
  });

  it("returns community for jobs item", () => {
    assert.equal(getActiveGroup("/org/jobs", "/org", items), "community");
  });

  it("returns null when no match", () => {
    assert.equal(getActiveGroup("/org/unknown", "/org", items), null);
  });
});

describe("buildSectionOrder", () => {
  it("renders in correct order: dashboard > groups > admin", () => {
    const items = [
      makeItem({ href: "", label: "Dashboard" }),
      makeItem({ href: "/members", label: "Members", group: "people" }),
      makeItem({ href: "/chat", label: "Chat", group: "community" }),
      makeItem({ href: "/events", label: "Events", group: "schedule" }),
      makeItem({ href: "/workouts", label: "Workouts", group: "activity" }),
      makeItem({ href: "/donations", label: "Donations", group: "finance" }),
      makeItem({ href: "/jobs", label: "Jobs", group: "community" }),
      makeItem({ href: "/customization", label: "Customization", group: "admin" }),
    ];
    const buckets = bucketItemsByGroup(items);
    const sections = buildSectionOrder(buckets, ORG_NAV_GROUPS);

    assert.equal(sections[0].type, "dashboard");
    assert.equal(sections[1].type, "group");
    assert.equal((sections[1] as any).group.id, "people");
    assert.equal(sections[2].type, "group");
    assert.equal((sections[2] as any).group.id, "community");
    assert.equal(sections[3].type, "group");
    assert.equal((sections[3] as any).group.id, "schedule");
    assert.equal(sections[4].type, "group");
    assert.equal((sections[4] as any).group.id, "activity");
    assert.equal(sections[5].type, "group");
    assert.equal((sections[5] as any).group.id, "finance");
    assert.equal(sections[6].type, "divider");
    assert.equal(sections[7].type, "group");
    assert.equal((sections[7] as any).group.id, "admin");
  });

  it("excludes empty groups", () => {
    const items = [
      makeItem({ href: "", label: "Dashboard" }),
      makeItem({ href: "/members", label: "Members", group: "people" }),
    ];
    const buckets = bucketItemsByGroup(items);
    const sections = buildSectionOrder(buckets, ORG_NAV_GROUPS);

    assert.equal(sections.length, 2); // dashboard + people
    assert.equal(sections[0].type, "dashboard");
    assert.equal(sections[1].type, "group");
    assert.equal((sections[1] as any).group.id, "people");
  });

  it("excludes admin section and divider when no admin items", () => {
    const items = [
      makeItem({ href: "", label: "Dashboard" }),
      makeItem({ href: "/members", label: "Members", group: "people" }),
      makeItem({ href: "/jobs", label: "Jobs", group: "community" }),
    ];
    const buckets = bucketItemsByGroup(items);
    const sections = buildSectionOrder(buckets, ORG_NAV_GROUPS);

    const hasDivider = sections.some(s => s.type === "divider");
    const hasAdmin = sections.some(s => s.type === "group" && (s as any).group.id === "admin");
    assert.equal(hasDivider, false);
    assert.equal(hasAdmin, false);
  });
});

describe("buildGlobalIndexMap", () => {
  it("maps each item href to its index", () => {
    const items = [
      makeItem({ href: "", label: "Dashboard" }),
      makeItem({ href: "/members", label: "Members", group: "people" }),
      makeItem({ href: "/events", label: "Events", group: "schedule" }),
    ];
    const map = buildGlobalIndexMap(items);
    assert.equal(map.get(""), 0);
    assert.equal(map.get("/members"), 1);
    assert.equal(map.get("/events"), 2);
  });

  it("returns empty map for empty input", () => {
    const map = buildGlobalIndexMap([]);
    assert.equal(map.size, 0);
  });
});
