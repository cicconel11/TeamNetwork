export const MAX_UPLOAD_FILE_SIZE_BYTES = 10 * 1024 * 1024;

// React Native's fetch on file:// URIs may not populate `ok`
type BlobLikeResponse = {
  ok?: boolean;
  status?: number;
  blob: () => Promise<Blob>;
};

type StorageUploadResult = {
  error: { message?: string } | null;
};

type StorageBucket = {
  upload: (
    path: string,
    body: BodyInit | ArrayBuffer | Uint8Array,
    options: { contentType: string; upsert?: boolean }
  ) => Promise<StorageUploadResult>;
};

// Decoupled from Supabase types for testability
type StorageClient = {
  from: (bucket: string) => StorageBucket;
};

type FetchLike = (
  input: string,
  init?: RequestInit
) => Promise<BlobLikeResponse>;

export function validateFileSize(
  fileSize: number | null | undefined,
  {
    maxBytes = MAX_UPLOAD_FILE_SIZE_BYTES,
    message = "File size must be under 10MB",
  }: { maxBytes?: number; message?: string } = {}
): string | null {
  const normalizedFileSize = fileSize ?? 0;
  return normalizedFileSize > maxBytes ? message : null;
}

export function validateMimeType(
  mimeType: string | null | undefined,
  allowedMimeTypes: readonly string[] | ReadonlySet<string>,
  message: string
): string | null {
  const normalizedMimeType = mimeType ?? "";
  const isAllowed = Array.isArray(allowedMimeTypes)
    ? allowedMimeTypes.includes(normalizedMimeType)
    : (allowedMimeTypes as ReadonlySet<string>).has(normalizedMimeType);

  return isAllowed ? null : message;
}

export function buildTimestampedUploadPath(
  prefix: string,
  fileName: string,
  timestamp: number = Date.now()
): string {
  return `${prefix}/${timestamp}_${fileName}`;
}

export function buildCacheBustedUrl(
  publicUrl: string,
  timestamp: number = Date.now()
): string {
  const separator = publicUrl.includes("?") ? "&" : "?";
  return `${publicUrl}${separator}t=${timestamp}`;
}

export async function readBlobFromUri(
  uri: string,
  fetchImpl: FetchLike = fetch as unknown as FetchLike
): Promise<Blob> {
  const response = await fetchImpl(uri);
  if (response.ok === false) {
    throw new Error(`Failed to read local file (status ${response.status ?? "unknown"})`);
  }
  return response.blob();
}

/**
 * Reads a `file://` URI's bytes as a Uint8Array. Use this instead of
 * `readBlobFromUri` when uploading to Supabase Storage — RN's
 * `fetch(uri).then(r => r.blob())` returns a 0-byte Blob on iOS, which
 * silently writes empty objects to storage.
 *
 * Implementation: expo-file-system v19's `File(uri).base64()` reads the
 * actual bytes; decode base64 via the global atob polyfill (RN ≥0.72)
 * to a Uint8Array, which Supabase Storage's `upload()` accepts as a
 * binary BodyInit on RN.
 */
export async function readArrayBufferFromUri(uri: string): Promise<Uint8Array> {
  // Lazy require so unit tests (node env, no Expo) aren't forced to mock it.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { File } = require("expo-file-system") as {
    File: new (uri: string) => { base64: () => Promise<string> };
  };
  const base64 = await new File(uri).base64();
  // atob() is provided by RN's global polyfill (>=0.72).
  const binary = globalThis.atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export async function uploadToSignedUrl(
  signedUrl: string,
  blob: Blob,
  mimeType: string,
  fetchImpl: FetchLike = fetch as unknown as FetchLike
): Promise<void> {
  const response = await fetchImpl(signedUrl, {
    method: "PUT",
    headers: { "Content-Type": mimeType },
    body: blob,
  });

  if (response.ok === false) {
    throw new Error("Failed to upload file to storage");
  }
}

export async function uploadToStorage(params: {
  storage: StorageClient;
  bucket: string;
  path: string;
  body: BodyInit | ArrayBuffer | Uint8Array;
  contentType: string;
  upsert?: boolean;
}): Promise<void> {
  const { storage, bucket, path, body, contentType, upsert } = params;
  const { error } = await storage.from(bucket).upload(path, body, {
    contentType,
    upsert,
  });

  if (error) {
    throw new Error(error.message || "Upload failed");
  }
}
