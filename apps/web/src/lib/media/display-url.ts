/**
 * Resolves the URL to display in a media card thumbnail.
 *
 * For videos without a server-generated thumbnail, returns null so the
 * card renders a placeholder instead of routing the .mp4 through the
 * Next.js Image optimizer (which only supports image formats).
 */
export function getCardDisplayUrl(item: {
  media_type: "image" | "video";
  thumbnail_url: string | null;
  url: string | null;
  external_url?: string | null;
}): string | null {
  if (item.media_type === "video") {
    return item.thumbnail_url || null;
  }
  return item.thumbnail_url || item.url || item.external_url || null;
}
