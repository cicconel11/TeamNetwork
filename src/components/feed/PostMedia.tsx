import Image from "next/image";
import type { MediaAttachment } from "@/lib/media/fetch";

interface PostMediaProps {
  media: MediaAttachment[];
}

export function PostMedia({ media }: PostMediaProps) {
  const images = media.filter((m) => m.mimeType.startsWith("image/"));
  if (images.length === 0) return null;

  if (images.length === 1) {
    const img = images[0];
    if (!img.previewUrl) return null;
    return (
      <div className="mt-3 rounded-xl overflow-hidden bg-muted">
        <Image
          src={img.previewUrl}
          alt={img.fileName || "Post image"}
          width={700}
          height={438}
          className="w-full h-auto object-cover hover:brightness-[1.02] transition-all duration-300"
        />
      </div>
    );
  }

  if (images.length === 3) {
    return (
      <div className="mt-3 flex flex-col gap-1.5 rounded-xl overflow-hidden">
        {/* First image full-width */}
        {images[0].previewUrl && (
          <div className="relative aspect-video bg-muted">
            <Image
              src={images[0].previewUrl}
              alt={images[0].fileName || "Post image"}
              fill
              className="object-cover hover:brightness-[1.02] transition-all duration-300"
            />
          </div>
        )}
        {/* Bottom two images half-width */}
        <div className="grid grid-cols-2 gap-1.5">
          {images.slice(1).map((img) =>
            img.previewUrl ? (
              <div key={img.id} className="relative aspect-square bg-muted">
                <Image
                  src={img.previewUrl}
                  alt={img.fileName || "Post image"}
                  fill
                  className="object-cover hover:brightness-[1.02] transition-all duration-300"
                />
              </div>
            ) : null
          )}
        </div>
      </div>
    );
  }

  // 2 or 4 images — uniform 2-column grid
  return (
    <div className="mt-3 grid grid-cols-2 gap-1.5 rounded-xl overflow-hidden">
      {images.map((img) =>
        img.previewUrl ? (
          <div key={img.id} className="relative aspect-square bg-muted">
            <Image
              src={img.previewUrl}
              alt={img.fileName || "Post image"}
              fill
              className="object-cover hover:brightness-[1.02] transition-all duration-300"
            />
          </div>
        ) : null
      )}
    </div>
  );
}
