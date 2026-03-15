import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "..");

const membersPageSource = fs.readFileSync(
  path.join(repoRoot, "src", "app", "[orgSlug]", "members", "page.tsx"),
  "utf8",
);
const alumniPageSource = fs.readFileSync(
  path.join(repoRoot, "src", "app", "[orgSlug]", "alumni", "page.tsx"),
  "utf8",
);
const parentsPageSource = fs.readFileSync(
  path.join(repoRoot, "src", "app", "[orgSlug]", "parents", "page.tsx"),
  "utf8",
);

for (const [label, source] of [
  ["members", membersPageSource],
  ["alumni", alumniPageSource],
  ["parents", parentsPageSource],
] as const) {
  test(`${label} directory keeps LinkedInBadge outside DirectoryCardLink`, () => {
    assert.match(
      source,
      /<\/DirectoryCardLink>\s*<LinkedInBadge linkedinUrl=\{[a-zA-Z_]+\.[a-z_]+\}/,
      `${label} directory should render the LinkedIn badge as a sibling after the main directory link`,
    );
    assert.match(
      source,
      /className="flex min-w-0 flex-1 items-center gap-4"/,
      `${label} directory should limit the main link to the primary card content`,
    );
  });
}
