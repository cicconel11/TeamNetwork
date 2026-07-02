// Compatibility shim — the generated Supabase types live in @teammeet/types
// (packages/types/src/database.ts), regenerated with `bun run gen:types` from
// the repo root. This re-export keeps the historical "@/types/database" import
// path working across the app; do not add types here.
export * from "@teammeet/types";
