import { randomUUID } from "crypto";

type TableName =
  | "payment_attempts"
  | "stripe_events"
  | "organizations"
  | "user_organization_roles"
  | "organization_subscriptions"
  | "organization_donations"
  | "calendar_feeds"
  | "calendar_events"
  | "schedule_allowed_domains"
  | "schedule_sources"
  | "schedule_events"
  | "form_submissions"
  | "notifications"
  | "notification_preferences"
  | "google_tokens"
  | "alumni"
  | "members"
  | "donations"
  | "philanthropy_events"
  | "users"
  | "chat_groups"
  | "chat_group_members"
  | "chat_messages"
  | "user_calendar_connections"
  | "event_calendar_entries";

type Row = Record<string, unknown>;

type SupabaseResponse<T> = {
  data: T | null;
  error: { code?: string; message: string } | null;
};

type CountResponse = {
  count: number | null;
  error: { code?: string; message: string } | null;
};

const uniqueKeys: Record<TableName, string[]> = {
  payment_attempts: ["idempotency_key", "stripe_payment_intent_id", "stripe_checkout_session_id"],
  stripe_events: ["event_id"],
  organizations: ["slug"],
  user_organization_roles: [],
  organization_subscriptions: ["organization_id"],
  organization_donations: ["stripe_payment_intent_id", "stripe_checkout_session_id"],
  calendar_feeds: [],
  calendar_events: [],
  schedule_allowed_domains: ["hostname"],
  schedule_sources: [],
  schedule_events: ["external_uid"],
  form_submissions: [],
  notifications: [],
  notification_preferences: [],
  google_tokens: ["user_id"],
  alumni: [],
  members: [],
  donations: [],
  philanthropy_events: [],
  users: [],
  chat_groups: [],
  chat_group_members: [],
  chat_messages: [],
  user_calendar_connections: ["user_id"],
  event_calendar_entries: [],
};

function nowIso() {
  return new Date().toISOString();
}

export function createSupabaseStub() {
  const storage: Record<TableName, Row[]> = {
    payment_attempts: [],
    stripe_events: [],
    organizations: [],
    user_organization_roles: [],
    organization_subscriptions: [],
    organization_donations: [],
    calendar_feeds: [],
    calendar_events: [],
    schedule_allowed_domains: [],
    schedule_sources: [],
    schedule_events: [],
    form_submissions: [],
    notifications: [],
    notification_preferences: [],
    google_tokens: [],
    alumni: [],
    members: [],
    donations: [],
    philanthropy_events: [],
    users: [],
    chat_groups: [],
    chat_group_members: [],
    chat_messages: [],
    user_calendar_connections: [],
    event_calendar_entries: [],
  };

  // RPC handler registry
  const rpcHandlers: Record<string, (params: Record<string, unknown>) => unknown> = {};

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
      const conflictColumns = options?.onConflict?.split(",").map((c) => c.trim()) ?? [];

      for (const record of records) {
        const existingIndex = conflictColumns.length > 0
          ? storage[table].findIndex((existing) =>
            conflictColumns.every((col) => existing[col] === record[col])
          )
          : -1;

        if (existingIndex >= 0) {
          const existing = storage[table][existingIndex];
          Object.entries(record).forEach(([key, value]) => {
            if (value !== undefined) {
              existing[key] = value;
            }
          });
          if (!("updated_at" in record)) {
            existing.updated_at = nowIso();
          }
        } else {
          const row: Row = {
            id: record.id || randomUUID(),
            created_at: record.created_at || nowIso(),
            updated_at: record.updated_at || nowIso(),
            ...record,
          };
          storage[table].push(row);
        }
      }

      return {
        then(resolve: (value: SupabaseResponse<null>) => void) {
          resolve({ data: null, error: null });
        },
      };
    },

    update: (updates: Row) => {
      const filters: ((row: Row) => boolean)[] = [];

      const applyUpdate = () => {
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
        return rows;
      };

      const builder = {
        eq(column: string, value: unknown) {
          filters.push((row) => row[column] === value);
          return builder;
        },
        in(column: string, values: unknown[]) {
          filters.push((row) => values.includes(row[column]));
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
        not(column: string, operator: string, value: unknown) {
          if (operator === "is") {
            filters.push((row) => {
              const cell = row[column];
              if (value === null) return cell !== null && cell !== undefined;
              return cell !== value;
            });
          }
          return builder;
        },
        select() {
          return builder;
        },
        maybeSingle(): SupabaseResponse<Row> {
          const rows = applyUpdate();
          if (!rows.length) {
            return { data: null, error: { code: "PGRST116", message: "No rows found" } };
          }
          return { data: clone(rows[0]), error: null };
        },
        single(): SupabaseResponse<Row> {
          return builder.maybeSingle();
        },
        then(resolve: (value: SupabaseResponse<Row[]>) => void) {
          const rows = applyUpdate();
          resolve({ data: clone(rows), error: null });
        },
      };

      return builder;
    },

    select: (columns?: string, options?: { count?: "exact"; head?: boolean }) => {
      const filters: ((row: Row) => boolean)[] = [];
      let sortColumn: string | null = null;
      let sortAscending = true;
      let limitCount: number | null = null;

      const builder = {
        eq(column: string, value: unknown) {
          filters.push((row) => row[column] === value);
          return builder;
        },
        neq(column: string, value: unknown) {
          filters.push((row) => row[column] !== value);
          return builder;
        },
        in(column: string, values: unknown[]) {
          filters.push((row) => values.includes(row[column]));
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
        not(column: string, operator: string, value: unknown) {
          if (operator === "is") {
            filters.push((row) => {
              const cell = row[column];
              if (value === null) return cell !== null && cell !== undefined;
              return cell !== value;
            });
          }
          return builder;
        },
        gt(column: string, value: unknown) {
          filters.push((row) => (row[column] as number) > (value as number));
          return builder;
        },
        gte(column: string, value: unknown) {
          filters.push((row) => (row[column] as number) >= (value as number));
          return builder;
        },
        lte(column: string, value: unknown) {
          filters.push((row) => (row[column] as number) <= (value as number));
          return builder;
        },
        order(column: string, opts?: { ascending?: boolean }) {
          sortColumn = column;
          sortAscending = opts?.ascending ?? true;
          return builder;
        },
        limit(count: number) {
          limitCount = count;
          return builder;
        },
        maybeSingle(): SupabaseResponse<Row> {
          let rows = applyFilters(storage[table], filters);
          if (sortColumn) {
            const col = sortColumn;
            rows = rows.sort((a, b) => {
              const aVal = a[col] as string | number;
              const bVal = b[col] as string | number;
              if (aVal < bVal) return sortAscending ? -1 : 1;
              if (aVal > bVal) return sortAscending ? 1 : -1;
              return 0;
            });
          }
          return { data: clone(rows[0] ?? null), error: null };
        },
        single(): SupabaseResponse<Row> {
          let rows = applyFilters(storage[table], filters);
          if (sortColumn) {
            const col = sortColumn;
            rows = rows.sort((a, b) => {
              const aVal = a[col] as string | number;
              const bVal = b[col] as string | number;
              if (aVal < bVal) return sortAscending ? -1 : 1;
              if (aVal > bVal) return sortAscending ? 1 : -1;
              return 0;
            });
          }
          if (rows.length !== 1) {
            return { data: null, error: { code: "PGRST116", message: "Not found" } };
          }
          return { data: clone(rows[0]), error: null };
        },
        then(resolve: (value: SupabaseResponse<Row[]> | CountResponse) => void) {
          let rows = applyFilters(storage[table], filters);
          if (sortColumn) {
            const col = sortColumn;
            rows = rows.sort((a, b) => {
              const aVal = a[col] as string | number;
              const bVal = b[col] as string | number;
              if (aVal < bVal) return sortAscending ? -1 : 1;
              if (aVal > bVal) return sortAscending ? 1 : -1;
              return 0;
            });
          }
          if (limitCount !== null) {
            rows = rows.slice(0, limitCount);
          }
          if (options?.count === "exact" && options.head) {
            resolve({ count: rows.length, error: null });
          } else {
            resolve({ data: clone(rows), error: null });
          }
        },
      };

      return builder;
    },

    delete: () => {
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
        then(resolve: (value: SupabaseResponse<null>) => void) {
          const toDelete = applyFilters(storage[table], filters);
          storage[table] = storage[table].filter((row) => !toDelete.includes(row));
          resolve({ data: null, error: null });
        },
      };

      return builder;
    },
  });

  /**
   * Seed the stub with initial data for testing.
   */
  const seed = (table: TableName, rows: Row[]) => {
    for (const row of rows) {
      const fullRow: Row = {
        id: row.id || randomUUID(),
        created_at: row.created_at || nowIso(),
        updated_at: row.updated_at || nowIso(),
        ...row,
      };
      storage[table].push(fullRow);
    }
  };

  /**
   * Clear all data from all tables or a specific table.
   */
  const clear = (table?: TableName) => {
    if (table) {
      storage[table] = [];
    } else {
      for (const key of Object.keys(storage) as TableName[]) {
        storage[key] = [];
      }
    }
  };

  /**
   * Register an RPC handler for testing.
   */
  const registerRpc = (name: string, handler: (params: Record<string, unknown>) => unknown) => {
    rpcHandlers[name] = handler;
  };

  /**
   * Call a registered RPC handler (mirrors supabase.rpc()).
   */
  const rpc = async (name: string, params: Record<string, unknown> = {}) => {
    const handler = rpcHandlers[name];
    if (!handler) {
      return { data: null, error: { code: "42883", message: `function ${name}() does not exist` } };
    }
    try {
      const result = handler(params);
      return { data: result, error: null };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return { data: null, error: { message } };
    }
  };

  return {
    from,
    rpc,
    getRows: (table: TableName) => clone(storage[table]),
    seed,
    clear,
    registerRpc,
  };
}
