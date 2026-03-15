import type { Database } from "@/types/database";
import type { MediaAttachment } from "@/lib/media/fetch";

export type PostWithAuthor = Database["public"]["Tables"]["feed_posts"]["Row"] & {
  author: { name: string } | null;
  liked_by_user: boolean;
  media?: MediaAttachment[];
};
