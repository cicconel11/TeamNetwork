// Error event payload shape (used by client and server)
export interface ErrorEventPayload {
  message: string; // Required: error message
  env: "development" | "staging" | "production"; // Required
  name?: string; // Error name (TypeError, etc.)
  stack?: string; // Stack trace
  route?: string; // Frontend route
  api_path?: string; // API endpoint
  component?: string; // React component name
  user_id?: string; // User ID if authenticated
  session_id?: string; // Session ID for correlation
  severity?: "low" | "medium" | "high" | "critical";
  meta?: Record<string, unknown>; // Additional context
}

// Breadcrumb types for tracking user actions leading to errors
export type BreadcrumbType = "navigation" | "network" | "click" | "console" | "error";

export interface Breadcrumb {
  type: BreadcrumbType;
  timestamp: number;
  message: string;
  data?: Record<string, unknown>;
}

// Browser metadata collected by client
export interface BrowserMeta {
  userAgent: string;
  language: string;
  cookiesEnabled: boolean;
}

export interface ViewportMeta {
  width: number;
  height: number;
  devicePixelRatio: number;
}

export interface ConnectionMeta {
  effectiveType?: string;
  downlink?: number;
  rtt?: number;
}

export interface MemoryMeta {
  jsHeapSizeLimit?: number;
  totalJSHeapSize?: number;
  usedJSHeapSize?: number;
}

export interface ClientMeta {
  browser: BrowserMeta;
  viewport: ViewportMeta;
  connection?: ConnectionMeta;
  memory?: MemoryMeta;
}

// Full client error payload sent to API
export interface ClientErrorPayload {
  name: string;
  message: string;
  stack?: string;
  route: string;
  env: "development" | "staging" | "production";
  user_id?: string;
  session_id: string;
  breadcrumbs: Breadcrumb[];
  meta: ClientMeta;
  context?: Record<string, unknown>;
}

export interface FingerprintResult {
  fingerprint: string; // 16-char hex hash
  title: string; // Human-readable title (max 80 chars)
  normalizedMessage: string; // Message after normalization
  topFrame: string | null; // Extracted stack frame
}

// Input for fingerprint generation (subset of ErrorEventPayload)
export type TelemetryErrorEvent = {
  name?: string;
  message: string;
  stack?: string;
  route?: string;
  api_path?: string;
  context?: Record<string, unknown>;
};
