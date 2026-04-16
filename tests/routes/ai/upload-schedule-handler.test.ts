/* eslint-disable @typescript-eslint/no-explicit-any */
import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";

const ORG_ID = "00000000-0000-4000-a000-000000000001";
const ADMIN_USER = { id: "00000000-0000-4000-a000-000000000099", email: "admin@example.com" };

const {
  createAiScheduleUploadDeleteHandler,
  createAiScheduleUploadHandler,
} = await import(
  "../../../src/app/api/ai/[orgId]/upload-schedule/handler.ts"
);

function buildRequest(file: File) {
  const formData = new FormData();
  formData.set("file", file);

  return new Request(`http://localhost/api/ai/${ORG_ID}/upload-schedule`, {
    method: "POST",
    body: formData,
  });
}

function buildDeleteRequest(storagePath: string) {
  return new Request(`http://localhost/api/ai/${ORG_ID}/upload-schedule`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ storagePath }),
  });
}

function buildHandlerDeps(storage: Record<string, unknown>, now?: () => number) {
  return {
    createClient: async () =>
      ({
        auth: { getUser: async () => ({ data: { user: ADMIN_USER } }) },
      }) as any,
    getAiOrgContext: async () =>
      ({
        ok: true,
        orgId: ORG_ID,
        userId: ADMIN_USER.id,
        role: "admin",
        supabase: null,
        serviceSupabase: { storage },
      }) as any,
    now,
  };
}

beforeEach(() => {
  (globalThis as { __rateLimitStore?: Map<string, unknown> }).__rateLimitStore?.clear();
});

test("upload-schedule accepts a valid PDF attachment", async () => {
  const uploads: Array<{
    bucket: string;
    path: string;
    data: Buffer;
    options: { contentType: string; upsert: boolean };
  }> = [];

  const handler = createAiScheduleUploadHandler({
    createClient: async () =>
      ({
        auth: { getUser: async () => ({ data: { user: ADMIN_USER } }) },
      }) as any,
    getAiOrgContext: async () =>
      ({
        ok: true,
        orgId: ORG_ID,
        userId: ADMIN_USER.id,
        role: "admin",
        supabase: null,
        serviceSupabase: {
          storage: {
            from(bucket: string) {
              return {
                upload: async (
                  path: string,
                  data: Buffer,
                  options: { contentType: string; upsert: boolean }
                ) => {
                  uploads.push({ bucket, path, data, options });
                  return { error: null };
                },
              };
            },
          },
        },
      }) as any,
    now: () => 1712000000000,
  });

  const response = await handler(
    buildRequest(new File([Buffer.from("%PDF-1.7\n")], "schedule.pdf", { type: "application/pdf" })) as any,
    { params: Promise.resolve({ orgId: ORG_ID }) }
  );
  const body = await response.json();

  assert.equal(response.status, 201);
  assert.deepEqual(body, {
    storagePath: `${ORG_ID}/${ADMIN_USER.id}/1712000000000_schedule.pdf`,
    fileName: "schedule.pdf",
    mimeType: "application/pdf",
  });
  assert.deepEqual(uploads, [
    {
      bucket: "ai-schedule-uploads",
      path: `${ORG_ID}/${ADMIN_USER.id}/1712000000000_schedule.pdf`,
      data: Buffer.from("%PDF-1.7\n"),
      options: {
        contentType: "application/pdf",
        upsert: false,
      },
    },
  ]);
});

test("upload-schedule accepts a valid PNG attachment", async () => {
  const uploads: Array<{
    bucket: string;
    path: string;
    options: { contentType: string; upsert: boolean };
  }> = [];

  const handler = createAiScheduleUploadHandler({
    createClient: async () =>
      ({
        auth: { getUser: async () => ({ data: { user: ADMIN_USER } }) },
      }) as any,
    getAiOrgContext: async () =>
      ({
        ok: true,
        orgId: ORG_ID,
        userId: ADMIN_USER.id,
        role: "admin",
        supabase: null,
        serviceSupabase: {
          storage: {
            from(bucket: string) {
              return {
                upload: async (
                  path: string,
                  _data: Buffer,
                  options: { contentType: string; upsert: boolean }
                ) => {
                  uploads.push({ bucket, path, options });
                  return { error: null };
                },
              };
            },
          },
        },
      }) as any,
    now: () => 1712000000001,
  });

  const pngHeader = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);
  const response = await handler(
    buildRequest(new File([pngHeader], "schedule.png", { type: "image/png" })) as any,
    { params: Promise.resolve({ orgId: ORG_ID }) }
  );

  assert.equal(response.status, 201);
  assert.deepEqual(uploads, [
    {
      bucket: "ai-schedule-uploads",
      path: `${ORG_ID}/${ADMIN_USER.id}/1712000000001_schedule.png`,
      options: {
        contentType: "image/png",
        upsert: false,
      },
    },
  ]);
});

test("upload-schedule creates the bucket when it is missing before upload", async () => {
  const createBucketCalls: Array<{ bucket: string; options: Record<string, unknown> }> = [];
  const uploads: string[] = [];
  const storage = {
    getBucket: async () => ({
      data: null,
      error: {
        message: "Bucket not found",
        name: "StorageApiError",
        status: 404,
        statusCode: "404",
      },
    }),
    createBucket: async (bucket: string, options: Record<string, unknown>) => {
      createBucketCalls.push({ bucket, options });
      return { error: null };
    },
    from(bucket: string) {
      return {
        upload: async (path: string) => {
          uploads.push(`${bucket}:${path}`);
          return { error: null };
        },
        remove: async () => ({ error: null }),
      };
    },
  };
  const handler = createAiScheduleUploadHandler(buildHandlerDeps(storage, () => 1712000000002));

  const pngHeader = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);
  const response = await handler(
    buildRequest(new File([pngHeader], "schedule.png", { type: "image/png" })) as any,
    { params: Promise.resolve({ orgId: ORG_ID }) }
  );

  assert.equal(response.status, 201);
  assert.deepEqual(createBucketCalls, [
    {
      bucket: "ai-schedule-uploads",
      options: {
        public: false,
        fileSizeLimit: 10 * 1024 * 1024,
        allowedMimeTypes: [
          "application/pdf",
          "image/png",
          "image/jpeg",
          "image/jpg",
        ],
      },
    },
  ]);
  assert.deepEqual(uploads, [
    `ai-schedule-uploads:${ORG_ID}/${ADMIN_USER.id}/1712000000002_schedule.png`,
  ]);
});

test("upload-schedule reconciles a stale bucket allowlist before upload", async () => {
  const updateBucketCalls: Array<{ bucket: string; options: Record<string, unknown> }> = [];
  const storage = {
    getBucket: async () => ({
      data: {
        public: false,
        fileSizeLimit: 10 * 1024 * 1024,
        allowedMimeTypes: ["application/pdf"],
      },
      error: null,
    }),
    updateBucket: async (bucket: string, options: Record<string, unknown>) => {
      updateBucketCalls.push({ bucket, options });
      return { error: null };
    },
    from() {
      return {
        upload: async () => ({ error: null }),
        remove: async () => ({ error: null }),
      };
    },
  };
  const handler = createAiScheduleUploadHandler(buildHandlerDeps(storage, () => 1712000000003));

  const pngHeader = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);
  const response = await handler(
    buildRequest(new File([pngHeader], "schedule.png", { type: "image/png" })) as any,
    { params: Promise.resolve({ orgId: ORG_ID }) }
  );

  assert.equal(response.status, 201);
  assert.deepEqual(updateBucketCalls, [
    {
      bucket: "ai-schedule-uploads",
      options: {
        public: false,
        fileSizeLimit: 10 * 1024 * 1024,
        allowedMimeTypes: [
          "application/pdf",
          "image/png",
          "image/jpeg",
          "image/jpg",
        ],
      },
    },
  ]);
});

test("upload-schedule rejects mismatched image content", async () => {
  const handler = createAiScheduleUploadHandler({
    createClient: async () =>
      ({
        auth: { getUser: async () => ({ data: { user: ADMIN_USER } }) },
      }) as any,
    getAiOrgContext: async () =>
      ({
        ok: true,
        orgId: ORG_ID,
        userId: ADMIN_USER.id,
        role: "admin",
        supabase: null,
        serviceSupabase: {
          storage: {
            from() {
              return {
                upload: async () => ({ error: null }),
              };
            },
          },
        },
      }) as any,
  });

  const response = await handler(
    buildRequest(new File([Buffer.from("%PDF-1.7\n")], "schedule.png", { type: "image/png" })) as any,
    { params: Promise.resolve({ orgId: ORG_ID }) }
  );
  const body = await response.json();

  assert.equal(response.status, 400);
  assert.deepEqual(body, {
    error: "File content does not match the declared file type",
  });
});

test("upload-schedule returns an actionable error when the bucket still rejects images", async () => {
  const handler = createAiScheduleUploadHandler({
    createClient: async () =>
      ({
        auth: { getUser: async () => ({ data: { user: ADMIN_USER } }) },
      }) as any,
    getAiOrgContext: async () =>
      ({
        ok: true,
        orgId: ORG_ID,
        userId: ADMIN_USER.id,
        role: "admin",
        supabase: null,
        serviceSupabase: {
          storage: {
            from() {
              return {
                upload: async () => ({
                  error: {
                    message: "mime type image/png is not allowed in this bucket",
                    name: "InvalidMimeType",
                  },
                }),
              };
            },
          },
        },
      }) as any,
  });

  const pngHeader = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);
  const response = await handler(
    buildRequest(new File([pngHeader], "schedule.png", { type: "image/png" })) as any,
    { params: Promise.resolve({ orgId: ORG_ID }) }
  );
  const body = await response.json();

  assert.equal(response.status, 500);
  assert.deepEqual(body, {
    error:
      "Schedule image uploads are not enabled for this storage bucket. Apply the AI schedule image bucket migration.",
  });
});

test("upload-schedule keeps unknown storage failures generic", async () => {
  const handler = createAiScheduleUploadHandler({
    createClient: async () =>
      ({
        auth: { getUser: async () => ({ data: { user: ADMIN_USER } }) },
      }) as any,
    getAiOrgContext: async () =>
      ({
        ok: true,
        orgId: ORG_ID,
        userId: ADMIN_USER.id,
        role: "admin",
        supabase: null,
        serviceSupabase: {
          storage: {
            from() {
              return {
                upload: async () => ({
                  error: {
                    message: "storage service unavailable",
                    name: "StorageUnknownError",
                  },
                }),
              };
            },
          },
        },
      }) as any,
  });

  const pngHeader = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);
  const response = await handler(
    buildRequest(new File([pngHeader], "schedule.png", { type: "image/png" })) as any,
    { params: Promise.resolve({ orgId: ORG_ID }) }
  );
  const body = await response.json();

  assert.equal(response.status, 500);
  assert.deepEqual(body, {
    error: "Failed to upload schedule",
  });
});

test("upload-schedule returns a permission error for storage policy failures", async () => {
  const handler = createAiScheduleUploadHandler({
    createClient: async () =>
      ({
        auth: { getUser: async () => ({ data: { user: ADMIN_USER } }) },
      }) as any,
    getAiOrgContext: async () =>
      ({
        ok: true,
        orgId: ORG_ID,
        userId: ADMIN_USER.id,
        role: "admin",
        supabase: null,
        serviceSupabase: {
          storage: {
            from() {
              return {
                upload: async () => ({
                  error: {
                    message: "new row violates row-level security policy",
                    name: "StorageApiError",
                    status: 403,
                    statusCode: "403",
                  },
                }),
              };
            },
          },
        },
      }) as any,
  });

  const pngHeader = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);
  const response = await handler(
    buildRequest(new File([pngHeader], "schedule.png", { type: "image/png" })) as any,
    { params: Promise.resolve({ orgId: ORG_ID }) }
  );
  const body = await response.json();

  assert.equal(response.status, 500);
  assert.deepEqual(body, {
    error: "Schedule uploads are not permitted for this organization storage path.",
  });
});

test("upload-schedule returns a storage configuration error for a missing bucket", async () => {
  const handler = createAiScheduleUploadHandler({
    createClient: async () =>
      ({
        auth: { getUser: async () => ({ data: { user: ADMIN_USER } }) },
      }) as any,
    getAiOrgContext: async () =>
      ({
        ok: true,
        orgId: ORG_ID,
        userId: ADMIN_USER.id,
        role: "admin",
        supabase: null,
        serviceSupabase: {
          storage: {
            from() {
              return {
                upload: async () => ({
                  error: {
                    message: "Bucket not found",
                    name: "StorageApiError",
                    status: 404,
                    statusCode: "404",
                  },
                }),
              };
            },
          },
        },
      }) as any,
  });

  const pngHeader = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);
  const response = await handler(
    buildRequest(new File([pngHeader], "schedule.png", { type: "image/png" })) as any,
    { params: Promise.resolve({ orgId: ORG_ID }) }
  );
  const body = await response.json();

  assert.equal(response.status, 500);
  assert.deepEqual(body, {
    error: "Schedule upload storage is not configured.",
  });
});

test("upload-schedule returns a retryable error for path collisions", async () => {
  const handler = createAiScheduleUploadHandler({
    createClient: async () =>
      ({
        auth: { getUser: async () => ({ data: { user: ADMIN_USER } }) },
      }) as any,
    getAiOrgContext: async () =>
      ({
        ok: true,
        orgId: ORG_ID,
        userId: ADMIN_USER.id,
        role: "admin",
        supabase: null,
        serviceSupabase: {
          storage: {
            from() {
              return {
                upload: async () => ({
                  error: {
                    message: "The resource already exists",
                    name: "StorageApiError",
                    status: 409,
                    statusCode: "409",
                  },
                }),
              };
            },
          },
        },
      }) as any,
  });

  const pngHeader = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);
  const response = await handler(
    buildRequest(new File([pngHeader], "schedule.png", { type: "image/png" })) as any,
    { params: Promise.resolve({ orgId: ORG_ID }) }
  );
  const body = await response.json();

  assert.equal(response.status, 500);
  assert.deepEqual(body, {
    error: "Schedule upload collision detected. Please retry.",
  });
});

test("upload-schedule falls back to the generic upload error for opaque failures", async () => {
  const handler = createAiScheduleUploadHandler({
    createClient: async () =>
      ({
        auth: { getUser: async () => ({ data: { user: ADMIN_USER } }) },
      }) as any,
    getAiOrgContext: async () =>
      ({
        ok: true,
        orgId: ORG_ID,
        userId: ADMIN_USER.id,
        role: "admin",
        supabase: null,
        serviceSupabase: {
          storage: {
            from() {
              return {
                upload: async () => ({
                  error: {
                    name: "StorageUnknownError",
                  },
                }),
              };
            },
          },
        },
      }) as any,
  });

  const pngHeader = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);
  const response = await handler(
    buildRequest(new File([pngHeader], "schedule.png", { type: "image/png" })) as any,
    { params: Promise.resolve({ orgId: ORG_ID }) }
  );
  const body = await response.json();

  assert.equal(response.status, 500);
  assert.deepEqual(body, {
    error: "Failed to upload schedule",
  });
});

test("upload-schedule delete removes an owned pending upload", async () => {
  const removedPaths: string[][] = [];
  const handler = createAiScheduleUploadDeleteHandler(buildHandlerDeps({
    from() {
      return {
        upload: async () => ({ error: null }),
        remove: async (paths: string[]) => {
          removedPaths.push(paths);
          return { error: null };
        },
      };
    },
  }));

  const response = await handler(
    buildDeleteRequest(`${ORG_ID}/${ADMIN_USER.id}/1712000000000_schedule.png`) as any,
    { params: Promise.resolve({ orgId: ORG_ID }) }
  );

  assert.equal(response.status, 204);
  assert.deepEqual(removedPaths, [[`${ORG_ID}/${ADMIN_USER.id}/1712000000000_schedule.png`]]);
});

test("upload-schedule delete rejects paths outside the caller prefix", async () => {
  const handler = createAiScheduleUploadDeleteHandler(buildHandlerDeps({
    from() {
      return {
        upload: async () => ({ error: null }),
        remove: async () => ({ error: null }),
      };
    },
  }));

  const response = await handler(
    buildDeleteRequest(`${ORG_ID}/someone-else/1712000000000_schedule.png`) as any,
    { params: Promise.resolve({ orgId: ORG_ID }) }
  );
  const body = await response.json();

  assert.equal(response.status, 400);
  assert.deepEqual(body, {
    error: "Invalid schedule attachment path",
  });
});

test("upload-schedule delete is idempotent when the object is already gone", async () => {
  const handler = createAiScheduleUploadDeleteHandler(buildHandlerDeps({
    from() {
      return {
        upload: async () => ({ error: null }),
        remove: async () => ({
          error: {
            message: "Object not found",
            name: "StorageApiError",
            status: 404,
            statusCode: "404",
          },
        }),
      };
    },
  }));

  const response = await handler(
    buildDeleteRequest(`${ORG_ID}/${ADMIN_USER.id}/1712000000000_schedule.png`) as any,
    { params: Promise.resolve({ orgId: ORG_ID }) }
  );

  assert.equal(response.status, 204);
});
