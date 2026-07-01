/**
 * Jobs domain — public API.
 *
 * Import job-board functionality from `@/domains/jobs` rather than reaching into
 * `server/` or `components/` directly. See `./README.md`.
 */

// Server: mutations + external source intake
export {
  createJobPosting,
  type CreateJobRequest,
  type CreateJobResult,
} from "./server/create-job";
export { updateJobPosting, type UpdateJobResult } from "./server/update-job";
export { deleteJobPosting, type DeleteJobResult } from "./server/delete-job";
export {
  fetchJobSourceDraft,
  extractJobSourceDraft,
  JobSourceIntakeError,
  type JobSourceDraft,
} from "./server/source-intake";

// UI components
export { JobList, JobForm, JobDetail, JobsFilters } from "./components";
