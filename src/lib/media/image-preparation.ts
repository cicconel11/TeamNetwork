const ORIGINAL_IMAGE_MAX_LONG_EDGE = 1920;
const PREVIEW_IMAGE_MAX_WIDTH = 1024;
const LOSSY_IMAGE_QUALITY = 0.82;

export type ImagePreparationPolicy = {
  outputMimeType: string;
  previewMimeType: string;
  preserveOriginalFile: boolean;
};

export type PreparedImageUpload = {
  file: File;
  previewFile: File | null;
  previewUrl: string | null;
  mimeType: string;
  previewMimeType: string | null;
  originalBytes: number;
  normalizedBytes: number;
};

export function resolveImagePreparationPolicy(mimeType: string): ImagePreparationPolicy {
  if (mimeType === "image/heic") {
    throw new Error("HEIC uploads are not supported in the browser yet. Convert to JPG, PNG, or WebP first.");
  }

  if (mimeType === "image/png") {
    return {
      outputMimeType: "image/png",
      previewMimeType: "image/png",
      preserveOriginalFile: false,
    };
  }

  if (mimeType === "image/webp") {
    return {
      outputMimeType: "image/webp",
      previewMimeType: "image/webp",
      preserveOriginalFile: false,
    };
  }

  if (mimeType === "image/gif") {
    return {
      outputMimeType: "image/gif",
      previewMimeType: "image/jpeg",
      preserveOriginalFile: true,
    };
  }

  return {
    outputMimeType: "image/jpeg",
    previewMimeType: "image/jpeg",
    preserveOriginalFile: false,
  };
}

export function fitWithinBounds(
  width: number,
  height: number,
  maxLongEdge: number,
): { width: number; height: number } {
  if (width <= 0 || height <= 0) {
    throw new Error("Image dimensions must be positive.");
  }

  const currentLongEdge = Math.max(width, height);
  if (currentLongEdge <= maxLongEdge) {
    return { width, height };
  }

  const scale = maxLongEdge / currentLongEdge;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

function renameFile(fileName: string, mimeType: string): string {
  const baseName = fileName.replace(/\.[^.]+$/, "");
  const extension = mimeType === "image/png"
    ? "png"
    : mimeType === "image/webp"
      ? "webp"
      : mimeType === "image/gif"
        ? "gif"
        : "jpg";
  return `${baseName}.${extension}`;
}

function buildPreviewFileName(fileName: string, mimeType: string): string {
  const baseName = fileName.replace(/\.[^.]+$/, "");
  const extension = mimeType === "image/png"
    ? "png"
    : mimeType === "image/webp"
      ? "webp"
      : "jpg";
  return `${baseName}-preview.${extension}`;
}

async function loadImageSource(file: File): Promise<{ width: number; height: number; source: CanvasImageSource }> {
  if (typeof createImageBitmap === "function") {
    const bitmap = await createImageBitmap(file);
    return { width: bitmap.width, height: bitmap.height, source: bitmap };
  }

  if (typeof Image === "undefined") {
    throw new Error("Image uploads are not supported in this environment.");
  }

  const objectUrl = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error("Failed to decode image."));
      element.src = objectUrl;
    });
    return { width: img.naturalWidth, height: img.naturalHeight, source: img };
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

async function renderCanvasBlob(
  source: CanvasImageSource,
  width: number,
  height: number,
  mimeType: string,
): Promise<Blob> {
  if (typeof document === "undefined") {
    throw new Error("Image uploads are not supported in this environment.");
  }

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Failed to prepare image upload.");
  }

  context.drawImage(source, 0, 0, width, height);

  const quality = mimeType === "image/jpeg" || mimeType === "image/webp"
    ? LOSSY_IMAGE_QUALITY
    : undefined;

  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, mimeType, quality);
  });

  if (!blob) {
    throw new Error("Failed to encode image upload.");
  }

  return blob;
}

export async function prepareImageUpload(file: File): Promise<PreparedImageUpload> {
  const policy = resolveImagePreparationPolicy(file.type);
  const originalBytes = file.size;

  const { width, height, source } = await loadImageSource(file);
  const normalizedSize = fitWithinBounds(width, height, ORIGINAL_IMAGE_MAX_LONG_EDGE);
  const previewSize = fitWithinBounds(width, height, PREVIEW_IMAGE_MAX_WIDTH);

  const normalizedFile = policy.preserveOriginalFile
    ? file
    : new File(
        [await renderCanvasBlob(source, normalizedSize.width, normalizedSize.height, policy.outputMimeType)],
        renameFile(file.name, policy.outputMimeType),
        { type: policy.outputMimeType, lastModified: file.lastModified },
      );

  const previewBlob = await renderCanvasBlob(
    source,
    previewSize.width,
    previewSize.height,
    policy.previewMimeType,
  );

  if ("close" in source && typeof source.close === "function") {
    source.close();
  }

  const previewFile = new File(
    [previewBlob],
    buildPreviewFileName(file.name, policy.previewMimeType),
    { type: policy.previewMimeType, lastModified: file.lastModified },
  );

  return {
    file: normalizedFile,
    previewFile,
    previewUrl: URL.createObjectURL(previewFile),
    mimeType: normalizedFile.type,
    previewMimeType: previewFile.type,
    originalBytes,
    normalizedBytes: normalizedFile.size,
  };
}

export const MEDIA_IMAGE_LIMITS = {
  originalMaxLongEdge: ORIGINAL_IMAGE_MAX_LONG_EDGE,
  previewMaxWidth: PREVIEW_IMAGE_MAX_WIDTH,
};
