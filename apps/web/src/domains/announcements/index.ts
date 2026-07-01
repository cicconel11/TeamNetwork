/**
 * Announcements domain — public API.
 *
 * Import announcement functionality from `@/domains/announcements` rather than
 * reaching into `server/` or `components/` directly. See `./README.md`.
 */

// Server: queries, mutations, permissions
export {
  filterAnnouncementsForUser,
  filterAnnouncementsForUserViaRpc,
  type AnnouncementViewerContext,
} from "./server/visibility";
export {
  createAnnouncement,
  sendAnnouncementNotification,
  type CreateAnnouncementRequest,
  type CreateAnnouncementResult,
  type SendAnnouncementNotificationRequest,
} from "./server/create-announcement";
export {
  updateAnnouncement,
  deleteAnnouncement,
  type UpdateAnnouncementRequest,
  type UpdateAnnouncementResult,
  type DeleteAnnouncementRequest,
  type DeleteAnnouncementResult,
} from "./server/update-announcement";

// UI components
export { AnnouncementCard } from "./components/AnnouncementCard";
export { AnnouncementsFeed } from "./components/AnnouncementsFeed";
export { MegaphoneIcon } from "./components/icons";
