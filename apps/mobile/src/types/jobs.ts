import type { Database } from "@teammeet/types";

/** Raw job_postings row from Supabase */
export type JobPosting = Database["public"]["Tables"]["job_postings"]["Row"];

/** Location type for job postings */
export type LocationType = "remote" | "onsite" | "hybrid";

/** Experience level for job postings */
export type ExperienceLevel = "entry" | "mid" | "senior" | "executive";

/** Poster info from users join */
export interface JobPoster {
  id: string;
  name: string | null;
  avatar_url: string | null;
}

/** Job posting with poster info — the hook's return shape */
export interface JobPostingWithPoster extends JobPosting {
  poster: JobPoster | null;
}

/** Filter options for the jobs list */
export interface JobFilters {
  query?: string;
  location_type?: LocationType;
  experience_level?: ExperienceLevel;
}

/** Input for creating a new job posting */
export interface CreateJobInput {
  title: string;
  company: string;
  description: string;
  location_type?: LocationType | null;
  experience_level?: ExperienceLevel | null;
  location?: string | null;
  application_url?: string | null;
  contact_email?: string | null;
  expires_at?: string | null;
}

/** Return type for useJobs hook */
export interface UseJobsReturn {
  jobs: JobPostingWithPoster[];
  loading: boolean;
  error: string | null;
  canPost: boolean;
  refetch: () => Promise<void>;
  refetchIfStale: () => void;
  createJob: (input: CreateJobInput) => Promise<void>;
  updateJob: (jobId: string, input: Partial<CreateJobInput>) => Promise<void>;
  deleteJob: (jobId: string) => Promise<void>;
}
