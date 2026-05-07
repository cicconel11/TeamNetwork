import test, { describe, beforeEach } from "node:test";
import assert from "node:assert";
import { randomUUID } from "node:crypto";
import { createSupabaseStub } from "./utils/supabaseStub.ts";
import { linkMediaToEntity } from "@/lib/media/link";

const ORG_ID = randomUUID();
const USER_ID = randomUUID();
const OTHER_USER_ID = randomUUID();
const OTHER_ORG_ID = randomUUID();

function makeMedia(overrides: Record<string, unknown> = {}) {
  return {
    id: randomUUID(),
    organization_id: ORG_ID,
    uploader_id: USER_ID,
    storage_path: `${ORG_ID}/feed_post/${randomUUID()}.png`,
    file_name: "photo.png",
    mime_type: "image/png",
    file_size: 1024,
    entity_type: null,
    entity_id: null,
    status: "ready",
    created_at: new Date().toISOString(),
    finalized_at: new Date().toISOString(),
    deleted_at: null,
    ...overrides,
  };
}

describe("linkMediaToEntity", () => {
  let stub: ReturnType<typeof createSupabaseStub>;

  beforeEach(() => {
    stub = createSupabaseStub();
  });

  test("returns linked=0 for empty mediaIds", async () => {
    const result = await linkMediaToEntity(stub as never, {
      mediaIds: [],
      entityType: "feed_post",
      entityId: randomUUID(),
      orgId: ORG_ID,
      userId: USER_ID,
    });
    assert.strictEqual(result.linked, 0);
    assert.strictEqual(result.error, undefined);
  });

  test("links valid ready media to entity", async () => {
    const media1 = makeMedia();
    const media2 = makeMedia();
    stub.seed("media_uploads", [media1, media2]);

    const entityId = randomUUID();
    const result = await linkMediaToEntity(stub as never, {
      mediaIds: [media1.id, media2.id],
      entityType: "feed_post",
      entityId,
      orgId: ORG_ID,
      userId: USER_ID,
    });

    assert.strictEqual(result.error, undefined);
    assert.ok(result.linked !== undefined);

    // Verify entity_type and entity_id were set
    const rows = stub.getRows("media_uploads");
    const linked1 = rows.find((r) => r.id === media1.id);
    const linked2 = rows.find((r) => r.id === media2.id);
    assert.strictEqual(linked1?.entity_type, "feed_post");
    assert.strictEqual(linked1?.entity_id, entityId);
    assert.strictEqual(linked2?.entity_type, "feed_post");
    assert.strictEqual(linked2?.entity_id, entityId);
  });

  test("rejects when exceeding maxAttachments for job_posting", async () => {
    const media1 = makeMedia();
    const media2 = makeMedia();
    stub.seed("media_uploads", [media1, media2]);

    const result = await linkMediaToEntity(stub as never, {
      mediaIds: [media1.id, media2.id],
      entityType: "job_posting",  // max 1 attachment
      entityId: randomUUID(),
      orgId: ORG_ID,
      userId: USER_ID,
    });

    assert.ok(result.error !== undefined);
    assert.ok(result.error.includes("Maximum 1"));
  });

  test("rejects when media belongs to different user", async () => {
    const media = makeMedia({ uploader_id: OTHER_USER_ID });
    stub.seed("media_uploads", [media]);

    const result = await linkMediaToEntity(stub as never, {
      mediaIds: [media.id],
      entityType: "feed_post",
      entityId: randomUUID(),
      orgId: ORG_ID,
      userId: USER_ID,
    });

    assert.ok(result.error !== undefined);
    assert.ok(result.error.includes("another user"));
  });

  test("rejects when media belongs to different org", async () => {
    const media = makeMedia({ organization_id: OTHER_ORG_ID });
    stub.seed("media_uploads", [media]);

    const result = await linkMediaToEntity(stub as never, {
      mediaIds: [media.id],
      entityType: "feed_post",
      entityId: randomUUID(),
      orgId: ORG_ID,
      userId: USER_ID,
    });

    assert.ok(result.error !== undefined);
    assert.ok(result.error.includes("not belong"));
  });

  test("rejects when media is not ready (pending)", async () => {
    const media = makeMedia({ status: "pending" });
    stub.seed("media_uploads", [media]);

    const result = await linkMediaToEntity(stub as never, {
      mediaIds: [media.id],
      entityType: "feed_post",
      entityId: randomUUID(),
      orgId: ORG_ID,
      userId: USER_ID,
    });

    assert.ok(result.error !== undefined);
    assert.ok(result.error.includes("not ready"));
  });

  test("rejects when some media IDs not found", async () => {
    const media = makeMedia();
    stub.seed("media_uploads", [media]);

    const result = await linkMediaToEntity(stub as never, {
      mediaIds: [media.id, randomUUID()], // second one doesn't exist
      entityType: "feed_post",
      entityId: randomUUID(),
      orgId: ORG_ID,
      userId: USER_ID,
    });

    assert.ok(result.error !== undefined);
    assert.ok(result.error.includes("not found"));
  });

  test("rejects soft-deleted media", async () => {
    const media = makeMedia({ deleted_at: new Date().toISOString() });
    stub.seed("media_uploads", [media]);

    const result = await linkMediaToEntity(stub as never, {
      mediaIds: [media.id],
      entityType: "feed_post",
      entityId: randomUUID(),
      orgId: ORG_ID,
      userId: USER_ID,
    });

    // Soft-deleted media should not be found (filtered by .is("deleted_at", null))
    assert.ok(result.error !== undefined);
    assert.ok(result.error.includes("not found"));
  });

  test("allows max attachments for discussion_thread (3)", async () => {
    const media = [makeMedia(), makeMedia(), makeMedia()];
    stub.seed("media_uploads", media);

    const result = await linkMediaToEntity(stub as never, {
      mediaIds: media.map(m => m.id),
      entityType: "discussion_thread", // max 3
      entityId: randomUUID(),
      orgId: ORG_ID,
      userId: USER_ID,
    });

    assert.strictEqual(result.error, undefined);
    assert.ok(result.linked !== undefined);
  });

  test("rejects exceeding max for discussion_thread (4 > 3)", async () => {
    const media = [makeMedia(), makeMedia(), makeMedia(), makeMedia()];
    stub.seed("media_uploads", media);

    const result = await linkMediaToEntity(stub as never, {
      mediaIds: media.map(m => m.id),
      entityType: "discussion_thread", // max 3
      entityId: randomUUID(),
      orgId: ORG_ID,
      userId: USER_ID,
    });

    assert.ok(result.error !== undefined);
    assert.ok(result.error.includes("Maximum 3"));
  });
});
