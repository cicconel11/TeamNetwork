import fs from "fs";
import path from "path";

const read = (rel: string) => fs.readFileSync(path.join(__dirname, rel), "utf8");

const createOrgSource = read("../app/(app)/(drawer)/create-org.tsx");
const orgListSource = read("../app/(app)/(drawer)/index.tsx");
const switcherSource = read("../src/components/org-switcher/OrgSwitcherActions.tsx");

describe("create-org iOS web handoff (Apple 3.1.1)", () => {
  it("opens the org-creation flow on the web at the documented route", () => {
    // Must hand off to /app/create-org (the single-org form), not /app/create
    // (the chooser) and not a self-redirect.
    expect(createOrgSource).toContain("Linking.openURL(`${getWebAppUrl()}/app/create-org`)");
    expect(createOrgSource).toContain('accessibilityLabel="Open on web"');
    expect(createOrgSource).toContain("Open on web");
  });

  it("no longer silently redirects iOS to the org list", () => {
    expect(createOrgSource).not.toContain('return <Redirect href="/(app)/(drawer)" />');
    expect(createOrgSource).not.toContain("import { Redirect");
  });

  it("still gates the native paid creation flow to non-iOS only", () => {
    // The iOS branch returns the handoff; the native form is below it.
    expect(createOrgSource).toContain('if (Platform.OS === "ios") {');
  });

  it("keeps create-org entry points reachable on iOS so the handoff is testable", () => {
    // Buttons must NOT be wrapped in a Platform.OS !== "ios" guard anymore.
    expect(orgListSource).not.toContain('Platform.OS !== "ios"');
    expect(switcherSource).not.toContain('Platform.OS !== "ios"');
    expect(orgListSource).toContain('router.push("/(app)/(drawer)/create-org" as never)');
    expect(switcherSource).toContain('router.push("/(app)/(drawer)/create-org" as never)');
  });
});
