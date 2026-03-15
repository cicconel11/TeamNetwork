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
    if (!img.url) return null;
    return (
      <div className="mt-3 rounded-xl overflow-hidden bg-muted">
        <Image
          src={img.url}
          alt={img.fileName || "Post image"}
          width={700}
          height={438}
          className="w-full h-auto object-cover hover:brightness-[1.02] transition-all duration-300"
          unoptimized
        />
      </div>
    );
  }

  return (
    <div className="mt-3 grid grid-cols-2 gap-1.5 rounded-xl overflow-hidden">
      {images.map((img) =>
        img.url ? (
          <div key={img.id} className="relative aspect-square bg-muted">
            <Image
              src={img.url}
              alt={img.fileName || "Post image"}
              fill
              className="object-cover hover:brightness-[1.02] transition-all duration-300"
              unoptimized
            />
          </div>
        ) : null
      )}
    </div>
  );
}
