// Discriminated result type for agent mutation primitives. The finite numeric
// status union maps to HTTP statuses the confirm handler returns to the
// client and keeps callers exhaustive at the type level — no accidental 500
// escape hatches.

export type DomainResult<T> =
  | { ok: true; value: T }
  | {
      ok: false;
      status: 400 | 403 | 404 | 409 | 410 | 422 | 500;
      error: string;
      details?: Record<string, unknown>;
    };
