export type ChatAttachment = {
  storagePath: string;
  fileName: string;
  mimeType: "application/pdf" | "image/png" | "image/jpeg" | "image/jpg";
};

export const SCHEDULE_ATTACHMENT_MIME_TYPES = new Set<ChatAttachment["mimeType"]>([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/jpg",
]);
