import { randomUUID } from "crypto";

/**
 * Extended Supabase stub for webhook handler testing.
 * Supports tables used by the Stripe webhook handler:
 * - stripe_events
 * - payment_attempts
 * - organizations
 * - organization_subscriptions
 * - organization_donations
 * - user_organization_roles
 */

type TableName =
  | "stripe_events"
  | "payment_attempts"
  | "organizations"
  | "organization_subscriptions"
  | "organization_donations"
  | "user_organization_roles";

type Row = Record<string, unknown>;

type SupabaseResponse<T> = {
  data: T | null;
  error: { code?: string; message: string } | null;
};

const uniqueKeys: Record<TableName, string[]> = {
  stripe_events: ["event_id"],
  payment_attempts: ["idempotency_key", "stripe_payment_intent_id", "stripe_checkout_session_id"],
  organizations: ["id", "slug"],
  organization_subscriptions: ["organization_id"],
  organization_donations: ["stripe_payment_intent_id", "stripe_checkout_session_id"],
  user_organization_roles: [],
};

function nowIso() {
  return new Date().toISOString();
}

export function createWebhookTestSupabase() {
  const storage: Record<TableName, Row[]> = {
    stripe_events: [],
    payment_attempts: [],
    organizations: [],
    organization_subscriptions: [],
    organization_donations: [],
    user_organization_roles: [],
  };

  const applyFilters = (rows: Row[], filters: ((row: Row) => boolean)[]) =>
    filters.reduce((current, filter) => current.filter(filter), rows);

  const clone = <T>(value: T) => JSON.parse(JSON.stringify(value)) as T;

  const from = (table: TableName) => ({
    insert: (payload: Row | Row[]) => {
      const records = Array.isArray(payload) ? payload : [payload];
      let error: SupabaseResponse<Row>["error"] = null;
      const inserted: Row[] = [];

      for (const record of records) {
        const row: Row = {
          id: record.id || randomUUID(),
          created_at: record.created_at || nowIso(),
          updated_at: record.updated_at || nowIso(),
          ...record,
        };

        const uniques = uniqueKeys[table] || [];
        const conflict = storage[table].find((existing) =>
          uniques.some(
            (field) =>
              row[field] !== undefined &&
              row[field] !== null &&
              existing[field] === row[field],
          ),
        );
        if (conflict) {
          error = { code: "23505", message: "duplicate key value" };
          break;
        }

        storage[table].push(row);
        inserted.push(row);
      }

      const builder = {
        select: () => builder,
        single: (): SupabaseResponse<Row> => ({ data: inserted[0] ?? null, error }),
        maybeSingle: (): SupabaseResponse<Row> => ({ data: inserted[0] ?? null, error }),
      };

      return builder;
    },

    upsert: (payload: Row | Row[], options?: { onConflict?: string }) => {
      const records = Array.isArray(payload) ? payload : [payload];
      const conflictField = options?.onConflict;
      let error: SupabaseResponse<Row>["error"] = null;
      const upserted: Row[] = [];

      for (const record of records) {
        let existing: Row | undefined;
        if (conflictField && record[conflictField]) {
          existing = storage[table].find(
            (row) => row[conflictField] === record[conflictField]
          );
        }

        if (existing) {
          // Update existing row
          Object.entries(record).forEach(([key, value]) => {
            if (value !== undefined) {
              existing![key] = value;
            }
          });
          existing.updated_at = nowIso();
          upserted.push(existing);
        } else {
          // Insert new row
          const row: Row = {
            id: record.id || randomUUID(),
            created_at: record.created_at || nowIso(),
            updated_at: record.updated_at || nowIso(),
            ...record,
          };
          storage[table].push(row);
          upserted.push(row);
        }
      }

      const builder = {
        select: () => builder,
        single: (): SupabaseResponse<Row> => ({ data: upserted[0] ?? null, error }),
        maybeSingle: (): SupabaseResponse<Row> => ({ data: upserted[0] ?? null, error }),
      };

      return builder;
    },

    update: (updates: Row) => {
      const filters: ((row: Row) => boolean)[] = [];

      const builder = {
        eq(column: string, value: unknown) {
          filters.push((row) => row[column] === value);
          return builder;
        },
        is(column: string, value: unknown) {
          filters.push((row) => {
            const cell = row[column];
            if (value === null) return cell === null || cell === undefined;
            return cell === value;
          });
          return builder;
        },
        select() {
          return builder;
        },
        maybeSingle(): SupabaseResponse<Row> {
          const rows = applyFilters(storage[table], filters);
          if (!rows.length) {
            return { data: null, error: { code: "PGRST116", message: "No rows found" } };
          }

          const target = rows[0];
          Object.entries(updates).forEach(([key, value]) => {
            if (value !== undefined) {
              target[key] = value;
            }
          });
          if (!("updated_at" in updates)) {
            target.updated_at = nowIso();
          }

          return { data: clone(target), error: null };
        },
        single(): SupabaseResponse<Row> {
          return builder.maybeSingle();
        },
        then(resolve: (result: SupabaseResponse<Row>) => void) {
          // Allow awaiting without calling single/maybeSingle
          const rows = applyFilters(storage[table], filters);
          for (const target of rows) {
            Object.entries(updates).forEach(([key, value]) => {
              if (value !== undefined) {
                target[key] = value;
              }
            });
            if (!("updated_at" in updates)) {
              target.updated_at = nowIso();
            }
          }
          resolve({ data: rows[0] ? clone(rows[0]) : null, error: null });
        },
      };

      return builder;
    },

    select: (columns?: string) => {
      const filters: ((row: Row) => boolean)[] = [];

      const builder = {
        eq(column: string, value: unknown) {
          filters.push((row) => row[column] === value);
          return builder;
        },
        is(column: string, value: unknown) {
          filters.push((row) => {
            const cell = row[column];
            if (value === null) return cell === null || cell === undefined;
            return cell === value;
          });
          return builder;
        },
        maybeSingle(): SupabaseResponse<Row> {
          const rows = applyFilters(storage[table], filters);
          return { data: clone(rows[0] ?? null), error: null };
        },
        single(): SupabaseResponse<Row> {
          const rows = applyFilters(storage[table], filters);
          if (rows.length !== 1) {
            return { data: null, error: { code: "PGRST116", message: "Not found" } };
          }
          return { data: clone(rows[0]), error: null };
        },
      };

      return builder;
    },
  });

  return {
    from,
    getRows: (table: TableName) => clone(storage[table]),

    // Helper methods for seeding test data
    seedOrganization(org: { id: string; slug: string; name: string; [key: string]: unknown }) {
      storage.organizations.push({
        id: org.id,
        slug: org.slug,
        name: org.name,
        description: org.description ?? null,
        primary_color: org.primary_color ?? "#1e3a5f",
        created_at: nowIso(),
        updated_at: nowIso(),
        ...org,
      });
    },

    seedSubscription(sub: {
      organization_id: string;
      stripe_subscription_id?: string;
      stripe_customer_id?: string;
      status?: string;
      current_period_end?: string;
      grace_period_ends_at?: string | null;
      [key: string]: unknown;
    }) {
      storage.organization_subscriptions.push({
        id: randomUUID(),
        organization_id: sub.organization_id,
        stripe_subscription_id: sub.stripe_subscription_id ?? null,
        stripe_customer_id: sub.stripe_customer_id ?? null,
        status: sub.status ?? "active",
        base_plan_interval: sub.base_plan_interval ?? "month",
        alumni_bucket: sub.alumni_bucket ?? "none",
        current_period_end: sub.current_period_end ?? null,
        grace_period_ends_at: sub.grace_period_ends_at ?? null,
        created_at: nowIso(),
        updated_at: nowIso(),
        ...sub,
      });
    },

    seedPaymentAttempt(attempt: {
      id: string;
      user_id: string;
      idempotency_key: string;
      status?: string;
      [key: string]: unknown;
    }) {
      storage.payment_attempts.push({
        id: attempt.id,
        user_id: attempt.user_id,
        idempotency_key: attempt.idempotency_key,
        status: attempt.status ?? "initiated",
        flow_type: attempt.flow_type ?? "subscription_checkout",
        amount_cents: attempt.amount_cents ?? null,
        currency: attempt.currency ?? "usd",
        created_at: nowIso(),
        updated_at: nowIso(),
        ...attempt,
      });
    },

    seedUserRole(role: {
      user_id: string;
      organization_id: string;
      role: string;
      status?: string;
    }) {
      storage.user_organization_roles.push({
        id: randomUUID(),
        user_id: role.user_id,
        organization_id: role.organization_id,
        role: role.role,
        status: role.status ?? "active",
        created_at: nowIso(),
        updated_at: nowIso(),
      });
    },

    // RPC mock for donation stats
    rpc: (name: string, params: Record<string, unknown>) => {
      // Mock RPC calls - just return success
      return Promise.resolve({ data: null, error: null });
    },
  };
}
