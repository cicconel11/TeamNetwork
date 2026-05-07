export function shouldUseNativeImage(src?: string | null): boolean {
  if (!src || src.startsWith("/")) {
    return false;
  }

  try {
    const { protocol } = new URL(src);
    return protocol === "http:" || protocol === "https:" || protocol === "blob:" || protocol === "data:";
  } catch {
    return false;
  }
}
