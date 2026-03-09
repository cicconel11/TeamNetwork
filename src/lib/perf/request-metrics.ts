/**
 * Request-scoped performance metrics for measuring DB round-trips
 * and render time per page. Temporary instrumentation — remove after
 * performance work is validated.
 *
 * Uses a simple global counter that resets per-request in server components.
 * Not thread-safe across concurrent requests, but sufficient for dev profiling.
 */

type Metrics = {
  authGetUserCalls: number;
  getOrgContextCalls: number;
  supabaseQueries: number;
  startTime: number;
};

let current: Metrics | null = null;

export function startMetrics(): void {
  current = {
    authGetUserCalls: 0,
    getOrgContextCalls: 0,
    supabaseQueries: 0,
    startTime: Date.now(),
  };
}

export function increment(key: keyof Omit<Metrics, "startTime">): void {
  if (current) {
    current[key]++;
  }
}

export function dumpMetrics(pageName: string): void {
  if (!current) return;
  const elapsed = Date.now() - current.startTime;
  console.log(
    `[PERF] ${pageName} | auth.getUser: ${current.authGetUserCalls} | getOrgContext: ${current.getOrgContextCalls} | queries: ${current.supabaseQueries} | ${elapsed}ms`
  );
  current = null;
}
