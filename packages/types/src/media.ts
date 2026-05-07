export type MediaStatus = "uploading" | "pending" | "approved" | "rejected";

export interface MediaItem {
  id: string;
  organization_id: string;
  uploaded_by: string;
  title: string;
  description: string | null;
  media_type: "image" | "video";
  storage_path: string | null;
  external_url: string | null;
  thumbnail_url: string | null;
  file_name: string | null;
  url: string; // computed: signed URL from storage_path or external_url
  file_size_bytes: number | null;
  mime_type: string | null;
  width: number | null;
  height: number | null;
  duration_seconds: number | null;
  taken_at: string | null;
  tags: string[];
  visibility: "all" | "members_only" | "admin_only";
  status: MediaStatus;
  moderated_by: string | null;
  moderated_at: string | null;
  rejection_reason: string | null;
  created_at: string;
  updated_at: string;
  uploader?: { name: string | null };
}

export interface MediaListResponse {
  data: MediaItem[];
  nextCursor: string | null;
  hasMore: boolean;
}

export interface MediaListParams {
  orgId: string;
  cursor?: string;
  limit?: number;
  media_type?: "image" | "video";
  tags?: string[];
  year?: number;
  status?: MediaStatus;
  uploadedBy?: string;
  sort?: "newest" | "oldest" | "title";
}

// v1.5
export interface MediaAlbum {
  id: string;
  organization_id: string;
  name: string;
  description: string | null;
  cover_media_id: string | null;
  cover_media?: MediaItem | null;
  created_by: string;
  item_count: number;
  created_at: string;
  updated_at: string;
  creator?: { name: string | null };
}
