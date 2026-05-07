/**
 * Apple Push Notification service (APNs) client.
 *
 * HTTP/2 + JWT (`.p8`) auth. Used by the notification dispatcher to send
 * standard `alert` pushes (when not going through Expo) and Live Activity
 * `liveactivity` pushes for the iOS Widget Extension.
 *
 * `jose` is used for the JWT (cross-runtime: Vercel Node + Supabase Edge
 * Functions). `jsonwebtoken` is intentionally avoided.
 */

export {
  ApnsClient,
  createApnsClient,
  type ApnsClientConfig,
  type ApnsPushType,
  type ApnsPriority,
  type SendApnsArgs,
  type SendApnsResult,
} from "./client";
