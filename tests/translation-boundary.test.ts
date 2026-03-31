import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function readSource(relativePath: string): string {
  return readFileSync(path.join(repoRoot, relativePath), "utf8");
}

test("root layout disables browser translation by default", () => {
  const source = readSource("src/app/layout.tsx");

  assert.match(source, /<body[^>]*translate="no"/);
});

test("UserContent explicitly opts stored content back into translation", () => {
  const source = readSource("src/components/i18n/UserContent.tsx");

  assert.match(source, /translate="yes"/);
  assert.match(source, /data-user-content/);
  assert.match(source, /lang=\{lang \?\? "und"\}/);
});

test("mixed-content renderers use UserContent for user-authored values", () => {
  const requiredFiles = [
    "src/components/chat/MessageBody.tsx",
    "src/components/chat/PollMessage.tsx",
    "src/components/chat/InlineFormMessage.tsx",
    "src/components/messages/ChatMessagePane.tsx",
    "src/components/messages/ThreadMessagePane.tsx",
    "src/components/discussions/ThreadDetail.tsx",
    "src/components/feed/PostDetail.tsx",
    "src/components/announcements/AnnouncementCard.tsx",
    "src/components/jobs/JobList.tsx",
    "src/components/jobs/JobDetail.tsx",
    "src/components/media/AlbumCard.tsx",
    "src/components/media/MediaCard.tsx",
    "src/components/media/MediaDetailModal.tsx",
  ];

  for (const relativePath of requiredFiles) {
    const source = readSource(relativePath);
    assert.match(
      source,
      /UserContent/,
      `${relativePath} should opt user-authored content into translation`,
    );
  }
});
