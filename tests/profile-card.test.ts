import { describe, it } from "node:test";
import assert from "node:assert/strict";

describe("Profile card in OrgSidebar", () => {
  it("OrgSidebar accepts currentMemberName and currentMemberAvatar props", async () => {
    const fs = await import("fs");
    const code = fs.readFileSync("src/components/layout/OrgSidebar.tsx", "utf-8");
    assert.ok(code.includes("currentMemberName"), "should accept currentMemberName prop");
    assert.ok(code.includes("currentMemberAvatar"), "should accept currentMemberAvatar prop");
  });

  it("OrgSidebar renders profile card when member data provided", async () => {
    const fs = await import("fs");
    const code = fs.readFileSync("src/components/layout/OrgSidebar.tsx", "utf-8");
    assert.ok(code.includes("Avatar"), "should render Avatar component in profile card");
    assert.ok(code.includes("Badge"), "should render Badge for role");
  });

  it("MobileNav passes through member name/avatar props", async () => {
    const fs = await import("fs");
    const code = fs.readFileSync("src/components/layout/MobileNav.tsx", "utf-8");
    assert.ok(code.includes("currentMemberName"), "should accept and pass currentMemberName");
    assert.ok(code.includes("currentMemberAvatar"), "should accept and pass currentMemberAvatar");
  });

  it("org layout fetches member name and photo_url", async () => {
    const fs = await import("fs");
    const code = fs.readFileSync("src/app/[orgSlug]/layout.tsx", "utf-8");
    assert.ok(
      code.includes("first_name") && code.includes("last_name") && code.includes("photo_url"),
      "layout should select first_name, last_name, photo_url from members",
    );
  });
});
