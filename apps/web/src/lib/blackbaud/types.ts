/** Raw constituent from SKY API GET /constituent/v1/constituents */
export interface BlackbaudConstituent {
  id: string;
  type: string;
  lookup_id?: string;
  first?: string;
  last?: string;
  preferred_name?: string;
  former_name?: string;
  suffix?: string;
  title?: string;
  gender?: string;
  birthdate?: { y: number; m: number; d: number };
  age?: number;
  deceased?: boolean;
  date_added?: string;
  date_modified?: string;
  gives_anonymously?: boolean;
  class_of?: string;
}

/** Raw email address from SKY API */
export interface BlackbaudEmail {
  id: string;
  address: string;
  type: string;
  primary?: boolean;
  inactive?: boolean;
  do_not_email?: boolean;
}

/** Raw phone from SKY API */
export interface BlackbaudPhone {
  id: string;
  number: string;
  type: string;
  primary?: boolean;
  inactive?: boolean;
  do_not_call?: boolean;
}

/** Raw address from SKY API */
export interface BlackbaudAddress {
  id: string;
  address_lines?: string;
  city?: string;
  state?: string;
  postal_code?: string;
  country?: string;
  type: string;
  primary?: boolean;
  inactive?: boolean;
}

/** Paginated list response from SKY API */
export interface BlackbaudListResponse<T> {
  count: number;
  next_link?: string;
  value: T[];
}

/** Normalized alumni record ready for upsert */
export interface NormalizedConstituent {
  external_id: string;
  first_name: string;
  last_name: string;
  email: string | null;
  phone_number: string | null;
  address_summary: string | null;
  graduation_year: number | null;
  source: "integration_sync";
}

/** OAuth token pair from Blackbaud */
export interface BlackbaudTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type: string;
}

/** Structured sync error stored in org_integrations.last_sync_error */
export interface SyncError {
  phase: "token_refresh" | "code_exchange" | "state_validation" | "api_verify" | "api_fetch" | "upsert";
  code: string;
  message: string;
  at: string;
}

/** Sync result returned by the sync engine */
export interface SyncResult {
  ok: boolean;
  created: number;
  updated: number;
  unchanged: number;
  skipped: number;
  error?: string;
}
