import { randomUUID } from "crypto";

type TableName = "payment_attempts" | "stripe_events";

type Row = Record<string, unknown>;

type SupabaseResponse<T> = {
  data: T | null;
  error: { code?: string; message: string } | null;
};

const uniqueKeys: Record<TableName, string[]> = {
  payment_attempts: ["idempotency_key", "stripe_payment_intent_id", "stripe_checkout_session_id"],
  stripe_events: ["event_id"],
};

function nowIso() {
  return new Date().toISOString();
}

export function createSupabaseStub() {
  const storage: Record<TableName, Row[]> = {
    payment_attempts: [],
    stripe_events: [],
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
      };

      return builder;
    },

    select: () => {
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
  };
}
