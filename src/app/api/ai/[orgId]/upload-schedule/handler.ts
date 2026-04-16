import { NextRequest, NextResponse } from "next/server";
import { getAiOrgContext } from "@/lib/ai/context";
import { checkRateLimit, buildRateLimitResponse } from "@/lib/security/rate-limit";
import { createClient } from "@/lib/supabase/server";
import { validateMagicBytes } from "@/lib/media/validation";
import { isOwnedScheduleUploadPath } from "@/lib/ai/schedule-upload-path";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BUCKET = "ai-schedule-uploads";
const MAX_BYTES = 10 * 1024 * 1024;
const ONE_HOUR_MS = 60 * 60 * 1000;
const ALLOWED_MIME_TYPES = [
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/jpg",
] as const;
const ALLOWED_MIME_TYPE_SET = new Set<ScheduleUploadMimeType>(ALLOWED_MIME_TYPES);
const IMAGE_MIME_TYPES = new Set<ScheduleUploadMimeType>([
  "image/png",
  "image/jpeg",
  "image/jpg",
]);
const BUCKET_OPTIONS = {
  public: false,
  fileSizeLimit: MAX_BYTES,
  allowedMimeTypes: [...ALLOWED_MIME_TYPES],
} as const;
const IMAGE_BUCKET_MISCONFIGURATION_ERROR =
  "Schedule image uploads are not enabled for this storage bucket. Apply the AI schedule image bucket migration.";
const STORAGE_NOT_CONFIGURED_ERROR = "Schedule upload storage is not configured.";
const STORAGE_PERMISSION_ERROR =
  "Schedule uploads are not permitted for this organization storage path.";
const STORAGE_COLLISION_ERROR = "Schedule upload collision detected. Please retry.";
const GENERIC_UPLOAD_ERROR = "Failed to upload schedule";
const GENERIC_DELETE_ERROR = "Failed to remove uploaded schedule";

type ScheduleUploadMimeType = (typeof ALLOWED_MIME_TYPES)[number];
type StorageUploadError = {
  message?: string;
  name?: string;
  code?: string;
  status?: number;
  statusCode?: string;
} | null;
type StorageBucketRecord = {
  public?: boolean | null;
  fileSizeLimit?: number | string | null;
  allowedMimeTypes?: string[] | null;
} | null;
type StorageApi = {
  getBucket?: (id: string) => Promise<{ data: StorageBucketRecord; error: StorageUploadError }>;
  createBucket?: (
    id: string,
    options: typeof BUCKET_OPTIONS
  ) => Promise<{ error: StorageUploadError }>;
  updateBucket?: (
    id: string,
    options: typeof BUCKET_OPTIONS
  ) => Promise<{ error: StorageUploadError }>;
  from: (bucket: string) => {
    upload: (
      path: string,
      data: Buffer,
      options: { contentType: string; upsert: boolean }
    ) => Promise<{ error: StorageUploadError }>;
    remove: (paths: string[]) => Promise<{ error: StorageUploadError }>;
  };
};

export interface AiScheduleUploadRouteDeps {
  createClient?: typeof createClient;
  getAiOrgContext?: typeof getAiOrgContext;
  now?: () => number;
}

function sanitizeFileName(fileName: string): string {
  const lastSegment = fileName.split(/[/\\]/).pop()?.trim() ?? "";
  const sanitized = lastSegment.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 200);
  return sanitized || "schedule-file";
}

function buildUploadErrorDetails(uploadError: StorageUploadError): string {
  return [
    uploadError?.name,
    uploadError?.code,
    uploadError?.statusCode,
    typeof uploadError?.status === "number" ? String(uploadError.status) : null,
    uploadError?.message,
  ]
    .filter((value): value is string => typeof value === "string" && value.length > 0)
    .join(" ")
    .toLowerCase();
}

function isImageBucketMisconfiguration(
  mimeType: string,
  uploadError: StorageUploadError
): boolean {
  if (!IMAGE_MIME_TYPES.has(mimeType as ScheduleUploadMimeType)) {
    return false;
  }

  const details = buildUploadErrorDetails(uploadError);
  return /mime/.test(details) && /(allowed|invalid|not allowed|not supported|unsupported)/.test(details);
}

function isMissingBucketError(uploadError: StorageUploadError): boolean {
  const details = buildUploadErrorDetails(uploadError);
  const message = typeof uploadError?.message === "string" ? uploadError.message.toLowerCase() : "";

  return uploadError?.status === 404
    || uploadError?.statusCode === "404"
    || /(bucket not found|bucket does not exist|no such bucket|missing bucket)/.test(message)
    || /(bucket not found|bucket does not exist|no such bucket|missing bucket)/.test(details);
}

function isMissingStorageObjectError(uploadError: StorageUploadError): boolean {
  const details = buildUploadErrorDetails(uploadError);
  const message = typeof uploadError?.message === "string" ? uploadError.message.toLowerCase() : "";

  return uploadError?.status === 404
    || uploadError?.statusCode === "404"
    || /(not found|no such object|object not found|resource not found)/.test(message)
    || /(not found|no such object|object not found|resource not found)/.test(details);
}

function getUploadFailureMessage(
  mimeType: string,
  uploadError: StorageUploadError
): string {
  const details = buildUploadErrorDetails(uploadError);

  if (isImageBucketMisconfiguration(mimeType, uploadError)) {
    return IMAGE_BUCKET_MISCONFIGURATION_ERROR;
  }

  if (isMissingBucketError(uploadError)) {
    return STORAGE_NOT_CONFIGURED_ERROR;
  }

  if (/(permission|forbidden|unauthorized|access denied|row-level security|rls|policy)/.test(details)) {
    return STORAGE_PERMISSION_ERROR;
  }

  if (/(already exists|duplicate|conflict|resource already exists)/.test(details)) {
    return STORAGE_COLLISION_ERROR;
  }

  return GENERIC_UPLOAD_ERROR;
}

function getDeleteFailureMessage(removeError: StorageUploadError): string {
  const details = buildUploadErrorDetails(removeError);

  if (isMissingBucketError(removeError) || isMissingStorageObjectError(removeError)) {
    return "";
  }

  if (/(permission|forbidden|unauthorized|access denied|row-level security|rls|policy)/.test(details)) {
    return STORAGE_PERMISSION_ERROR;
  }

  return GENERIC_DELETE_ERROR;
}

function normalizeBucketFileSizeLimit(
  fileSizeLimit: NonNullable<StorageBucketRecord>["fileSizeLimit"]
): number | null {
  if (typeof fileSizeLimit === "number" && Number.isFinite(fileSizeLimit)) {
    return fileSizeLimit;
  }

  if (typeof fileSizeLimit === "string" && fileSizeLimit.trim().length > 0) {
    const parsed = Number(fileSizeLimit);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function bucketNeedsReconciliation(bucket: StorageBucketRecord): boolean {
  if (!bucket) {
    return true;
  }

  if (bucket.public !== false) {
    return true;
  }

  if (normalizeBucketFileSizeLimit(bucket.fileSizeLimit) !== MAX_BYTES) {
    return true;
  }

  const allowedMimeTypes = new Set(
    Array.isArray(bucket.allowedMimeTypes)
      ? bucket.allowedMimeTypes
          .filter((value): value is string => typeof value === "string" && value.length > 0)
          .map((value) => value.toLowerCase())
      : []
  );

  return ALLOWED_MIME_TYPES.some((mimeType) => !allowedMimeTypes.has(mimeType));
}

async function ensureScheduleUploadBucket(
  storage: StorageApi,
  logContext: { orgId: string; mimeType: string }
): Promise<StorageUploadError> {
  if (typeof storage.getBucket !== "function") {
    return null;
  }

  const { data: bucket, error: getBucketError } = await storage.getBucket(BUCKET);
  if (getBucketError) {
    if (!isMissingBucketError(getBucketError)) {
      console.error("[ai/upload-schedule] Bucket lookup error:", getBucketError, logContext);
      return getBucketError;
    }

    if (typeof storage.createBucket !== "function") {
      return getBucketError;
    }

    const { error: createBucketError } = await storage.createBucket(BUCKET, BUCKET_OPTIONS);
    if (createBucketError) {
      console.error("[ai/upload-schedule] Bucket create error:", createBucketError, logContext);
      return createBucketError;
    }

    return null;
  }

  if (!bucketNeedsReconciliation(bucket)) {
    return null;
  }

  if (typeof storage.updateBucket !== "function") {
    return {
      name: "StorageBucketMisconfigured",
      message: IMAGE_BUCKET_MISCONFIGURATION_ERROR,
    };
  }

  const { error: updateBucketError } = await storage.updateBucket(BUCKET, BUCKET_OPTIONS);
  if (updateBucketError) {
    console.error("[ai/upload-schedule] Bucket update error:", updateBucketError, logContext);
    return updateBucketError;
  }

  return null;
}

export function createAiScheduleUploadHandler(
  deps: AiScheduleUploadRouteDeps = {}
) {
  const createClientFn = deps.createClient ?? createClient;
  const getAiOrgContextFn = deps.getAiOrgContext ?? getAiOrgContext;
  const nowFn = deps.now ?? Date.now;

  return async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ orgId: string }> }
  ) {
    try {
      const { orgId } = await params;

      if (!orgId || !UUID_RE.test(orgId)) {
        return NextResponse.json({ error: "Invalid organization" }, { status: 400 });
      }

      const supabase = await createClientFn();
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }

      const rateLimit = checkRateLimit(request, {
        userId: user.id,
        orgId,
        feature: "AI schedule upload",
        limitPerIp: 20,
        limitPerUser: 10,
        limitPerOrg: 20,
        windowMs: ONE_HOUR_MS,
      });
      if (!rateLimit.ok) {
        return buildRateLimitResponse(rateLimit);
      }

      const ctx = await getAiOrgContextFn(orgId, user, rateLimit, { supabase });
      if (!ctx.ok) {
        return ctx.response;
      }

      const formData = await request.formData();
      const file = formData.get("file");

      if (!file || typeof file === "string") {
        return NextResponse.json(
          { error: "file is required" },
          { status: 400, headers: rateLimit.headers }
        );
      }

      if (!ALLOWED_MIME_TYPE_SET.has(file.type as ScheduleUploadMimeType)) {
        return NextResponse.json(
          { error: "File must be a PDF or image" },
          { status: 400, headers: rateLimit.headers }
        );
      }

      if (file.size <= 0 || file.size > MAX_BYTES) {
        return NextResponse.json(
          { error: "File size must be under 10MB" },
          { status: 400, headers: rateLimit.headers }
        );
      }

      const fileName = sanitizeFileName(file.name);
      const timestamp = nowFn();
      const storagePath = `${orgId}/${ctx.userId}/${timestamp}_${fileName}`;
      const buffer = Buffer.from(await file.arrayBuffer());

      if (!validateMagicBytes(buffer, file.type)) {
        return NextResponse.json(
          { error: "File content does not match the declared file type" },
          { status: 400, headers: rateLimit.headers }
        );
      }

      const bucketError = await ensureScheduleUploadBucket(ctx.serviceSupabase.storage as StorageApi, {
        orgId,
        mimeType: file.type,
      });
      if (bucketError) {
        return NextResponse.json(
          { error: getUploadFailureMessage(file.type, bucketError) },
          { status: 500, headers: rateLimit.headers }
        );
      }

      const { error: uploadError } = await (ctx.serviceSupabase.storage as StorageApi)
        .from(BUCKET)
        .upload(storagePath, buffer, {
          contentType: file.type,
          upsert: false,
        });

      if (uploadError) {
        console.error("[ai/upload-schedule] Upload error:", uploadError, {
          orgId,
          storagePath,
          mimeType: file.type,
          errorName: uploadError.name,
          errorMessage: uploadError.message,
          errorCode: uploadError.code,
          errorStatus: uploadError.status,
          errorStatusCode: uploadError.statusCode,
        });

        return NextResponse.json(
          { error: getUploadFailureMessage(file.type, uploadError) },
          { status: 500, headers: rateLimit.headers }
        );
      }

      return NextResponse.json(
        { storagePath, fileName, mimeType: file.type },
        { status: 201, headers: rateLimit.headers }
      );
    } catch (error) {
      console.error("[ai/upload-schedule] Error:", error, {
        errorName: error instanceof Error ? error.name : null,
        errorMessage: error instanceof Error ? error.message : String(error),
      });
      return NextResponse.json({ error: "Failed to process upload" }, { status: 500 });
    }
  };
}

export function createAiScheduleUploadDeleteHandler(
  deps: AiScheduleUploadRouteDeps = {}
) {
  const createClientFn = deps.createClient ?? createClient;
  const getAiOrgContextFn = deps.getAiOrgContext ?? getAiOrgContext;

  return async function DELETE(
    request: NextRequest,
    { params }: { params: Promise<{ orgId: string }> }
  ) {
    try {
      const { orgId } = await params;

      if (!orgId || !UUID_RE.test(orgId)) {
        return NextResponse.json({ error: "Invalid organization" }, { status: 400 });
      }

      const supabase = await createClientFn();
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }

      const rateLimit = checkRateLimit(request, {
        userId: user.id,
        orgId,
        feature: "AI schedule upload cleanup",
        limitPerIp: 20,
        limitPerUser: 10,
        limitPerOrg: 20,
        windowMs: ONE_HOUR_MS,
      });
      if (!rateLimit.ok) {
        return buildRateLimitResponse(rateLimit);
      }

      const ctx = await getAiOrgContextFn(orgId, user, rateLimit, { supabase });
      if (!ctx.ok) {
        return ctx.response;
      }

      let body: { storagePath?: unknown };
      try {
        body = await request.json();
      } catch {
        return NextResponse.json(
          { error: "storagePath is required" },
          { status: 400, headers: rateLimit.headers }
        );
      }

      if (
        typeof body.storagePath !== "string"
        || !isOwnedScheduleUploadPath(orgId, ctx.userId, body.storagePath)
      ) {
        return NextResponse.json(
          { error: "Invalid schedule attachment path" },
          { status: 400, headers: rateLimit.headers }
        );
      }

      const { error: removeError } = await (ctx.serviceSupabase.storage as StorageApi)
        .from(BUCKET)
        .remove([body.storagePath]);

      if (removeError) {
        const deleteFailureMessage = getDeleteFailureMessage(removeError);
        if (deleteFailureMessage.length === 0) {
          return new NextResponse(null, { status: 204, headers: rateLimit.headers });
        }

        console.error("[ai/upload-schedule] Delete error:", removeError, {
          orgId,
          storagePath: body.storagePath,
          errorName: removeError.name,
          errorMessage: removeError.message,
          errorCode: removeError.code,
          errorStatus: removeError.status,
          errorStatusCode: removeError.statusCode,
        });

        return NextResponse.json(
          { error: deleteFailureMessage },
          { status: 500, headers: rateLimit.headers }
        );
      }

      return new NextResponse(null, { status: 204, headers: rateLimit.headers });
    } catch (error) {
      console.error("[ai/upload-schedule] Delete handler error:", error, {
        errorName: error instanceof Error ? error.name : null,
        errorMessage: error instanceof Error ? error.message : String(error),
      });
      return NextResponse.json({ error: GENERIC_DELETE_ERROR }, { status: 500 });
    }
  };
}
