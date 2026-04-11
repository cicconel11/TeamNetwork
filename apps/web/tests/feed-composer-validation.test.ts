import test from "node:test";
import assert from "node:assert/strict";
import {
  prepareFeedImageEntries,
  FEED_POST_MAX_FILE_SIZE,
} from "@/lib/media/feed-composer-prep";
import type { PreparedImageUpload } from "@/lib/media/image-preparation";

function bigJpeg(bytes: number, name = "IMG_0001.jpeg"): File {
  const f = new File([new Uint8Array(0)], name, { type: "image/jpeg" });
  Object.defineProperty(f, "size", { value: bytes });
  return f;
}

function makePrepStub(compressedBytes: number) {
  return async (file: File): Promise<PreparedImageUpload> => {
    const renamed = file.name.replace(/\.jpeg$/i, ".jpg");
    const compressed = new File([new Uint8Array(compressedBytes)], renamed, {
      type: "image/jpeg",
      lastModified: file.lastModified,
    });
    const previewFile = new File([new Uint8Array(8_000)], `preview-${renamed}`, {
      type: "image/jpeg",
    });
    return {
      file: compressed,
      previewFile,
      previewUrl: "blob:fake-preview",
      mimeType: "image/jpeg",
      previewMimeType: "image/jpeg",
      originalBytes: file.size,
      normalizedBytes: compressedBytes,
    };
  };
}

function makeGifFile(bytes: Uint8Array, name = "tiny.gif"): File {
  return new File([bytes], name, { type: "image/gif" });
}

test("FEED_POST_MAX_FILE_SIZE comes from MEDIA_CONSTRAINTS.feed_post (10 MB)", () => {
  assert.equal(FEED_POST_MAX_FILE_SIZE, 10 * 1024 * 1024);
});

test("prepareFeedImageEntries accepts a 14 MB JPEG that compresses below the cap", async () => {
  const file = bigJpeg(14 * 1024 * 1024);
  const { prepared, skipped } = await prepareFeedImageEntries({
    files: [file],
    slotsAvailable: 4,
    prepareImage: makePrepStub(600_000),
  });

  assert.deepEqual(skipped, []);
  assert.equal(prepared.length, 1);
  assert.equal(prepared[0].fileSize, 600_000);
  assert.equal(prepared[0].mimeType, "image/jpeg");
});

test("prepareFeedImageEntries skips a JPEG that stays above 10 MB after prep", async () => {
  const file = bigJpeg(20 * 1024 * 1024, "huge.jpeg");
  const { prepared, skipped } = await prepareFeedImageEntries({
    files: [file],
    slotsAvailable: 4,
    prepareImage: makePrepStub(11 * 1024 * 1024),
  });

  assert.deepEqual(prepared, []);
  assert.equal(skipped.length, 1);
  assert.match(skipped[0], /huge\.jpeg/);
  assert.match(skipped[0], /under 10MB/);
});

test("prepareFeedImageEntries rejects a 51 MB JPEG before prep", async () => {
  const file = bigJpeg(51 * 1024 * 1024, "too-large.jpeg");
  let prepCalls = 0;
  const { prepared, skipped } = await prepareFeedImageEntries({
    files: [file],
    slotsAvailable: 4,
    prepareImage: async (input) => {
      prepCalls++;
      return makePrepStub(600_000)(input);
    },
  });

  assert.equal(prepCalls, 0);
  assert.deepEqual(prepared, []);
  assert.equal(skipped.length, 1);
  assert.match(skipped[0], /too-large\.jpeg/);
  assert.match(skipped[0], /under 50MB/);
});

test("prepareFeedImageEntries rejects unsupported mime types at raw-time", async () => {
  const pdf = new File(["pdf"], "doc.pdf", { type: "application/pdf" });
  const { prepared, skipped } = await prepareFeedImageEntries({
    files: [pdf],
    slotsAvailable: 4,
    prepareImage: makePrepStub(600_000),
  });

  assert.deepEqual(prepared, []);
  assert.equal(skipped.length, 1);
  assert.match(skipped[0], /JPEG, PNG, WebP, and GIF/);
});

test("prepareFeedImageEntries enforces slotsAvailable", async () => {
  const a = bigJpeg(1000, "a.jpeg");
  const b = bigJpeg(1000, "b.jpeg");
  const c = bigJpeg(1000, "c.jpeg");
  const { prepared, skipped } = await prepareFeedImageEntries({
    files: [a, b, c],
    slotsAvailable: 2,
    prepareImage: makePrepStub(600),
  });

  assert.equal(prepared.length, 2);
  assert.equal(skipped.length, 1);
  assert.match(skipped[0], /maximum/);
});

test("prepareFeedImageEntries lets GIFs pass through without prep but enforces raw-size cap", async () => {
  const smallGif = makeGifFile(new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]), "tiny.gif");
  Object.defineProperty(smallGif, "size", { value: 500_000 });

  const bigGif = makeGifFile(new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]), "huge.gif");
  Object.defineProperty(bigGif, "size", { value: 12 * 1024 * 1024 });

  let prepCalls = 0;
  const { prepared, skipped } = await prepareFeedImageEntries({
    files: [smallGif, bigGif],
    slotsAvailable: 4,
    prepareImage: async (f) => {
      prepCalls++;
      return makePrepStub(600)(f);
    },
  });

  // GIFs do not go through prep
  assert.equal(prepCalls, 0);
  assert.equal(prepared.length, 1);
  assert.equal(prepared[0].mimeType, "image/gif");
  assert.equal(skipped.length, 1);
  assert.match(skipped[0], /huge\.gif/);
  assert.match(skipped[0], /under 10MB/);
});

test("prepareFeedImageEntries rejects empty GIFs before upload", async () => {
  const emptyGif = new File([], "empty.gif", { type: "image/gif" });
  const { prepared, skipped } = await prepareFeedImageEntries({
    files: [emptyGif],
    slotsAvailable: 4,
    prepareImage: makePrepStub(600),
  });

  assert.deepEqual(prepared, []);
  assert.equal(skipped.length, 1);
  assert.match(skipped[0], /empty\.gif/);
  assert.match(skipped[0], /empty/i);
});

test("prepareFeedImageEntries rejects GIFs with invalid header bytes", async () => {
  const invalidGif = makeGifFile(new Uint8Array([0x00, 0x01, 0x02, 0x03, 0x04, 0x05]), "garbage.gif");
  const { prepared, skipped } = await prepareFeedImageEntries({
    files: [invalidGif],
    slotsAvailable: 4,
    prepareImage: makePrepStub(600),
  });

  assert.deepEqual(prepared, []);
  assert.equal(skipped.length, 1);
  assert.match(skipped[0], /garbage\.gif/);
  assert.match(skipped[0], /invalid GIF/i);
});

test("prepareFeedImageEntries accepts GIF87a/GIF89a headers without invoking prep", async () => {
  const gif87a = makeGifFile(new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x37, 0x61]), "anim-87a.gif");
  const gif89a = makeGifFile(new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]), "anim-89a.gif");

  let prepCalls = 0;
  const { prepared, skipped } = await prepareFeedImageEntries({
    files: [gif87a, gif89a],
    slotsAvailable: 4,
    prepareImage: async (file) => {
      prepCalls++;
      return makePrepStub(600)(file);
    },
  });

  assert.equal(prepCalls, 0);
  assert.deepEqual(skipped, []);
  assert.equal(prepared.length, 2);
  assert.equal(prepared[0].mimeType, "image/gif");
  assert.equal(prepared[1].mimeType, "image/gif");
});
