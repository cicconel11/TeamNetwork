#!/usr/bin/env node
// @ts-nocheck
/**
 * generate-db-okf.mjs
 *
 * Deterministic generator for the database-schema OKF (Open Knowledge Format)
 * bundle. Parses `apps/web/src/types/database.ts` (the Supabase-generated type
 * source of truth) and emits one markdown doc per public table into
 * `docs/db/okf/`, plus an `index.md`. Each doc carries OKF frontmatter and the
 * intra-bundle markdown links between FK-related tables form the OKF graph.
 *
 * Default mode is fully deterministic (templated descriptions) so output is
 * reproducible and testable. An optional `--llm` flag is reserved for
 * LLM-assisted descriptions but is intentionally NOT wired here to avoid
 * spend/scope; the deterministic path always produces a valid bundle.
 *
 * Usage:
 *   node scripts/generate-db-okf.mjs [--timestamp <ISO-8601>] [--llm] [--check]
 *
 *   --timestamp   Fixed ISO-8601 timestamp stamped into every doc's frontmatter
 *                 (keeps output reproducible). Defaults to DEFAULT_TIMESTAMP.
 *   --llm         Reserved flag for LLM-assisted descriptions. Not yet wired;
 *                 the generator prints a notice and falls back to deterministic
 *                 templates so the bundle is always valid.
 *   --check       Run the self-consistency assertions only (no write). Exits
 *                 non-zero if the on-disk bundle is missing or inconsistent.
 *
 * The generator runs in CI / locally as a build-time step. A runtime cron is
 * deliberately NOT provided for the doc generation itself (serverless functions
 * cannot write repo files); see apps/web/src/app/api/cron/okf-enrich.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");
const DATABASE_TS = join(REPO_ROOT, "apps/web/src/types/database.ts");
const OUT_DIR = join(REPO_ROOT, "docs/db/okf");
const RESOURCE_PATH = "/apps/web/src/types/database.ts";

// Fixed default so output is reproducible when no --timestamp is passed.
const DEFAULT_TIMESTAMP = "2026-01-01T00:00:00Z";

// ---------------------------------------------------------------------------
// CLI parsing
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const args = { timestamp: DEFAULT_TIMESTAMP, llm: false, check: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--llm") {
      args.llm = true;
    } else if (arg === "--check") {
      args.check = true;
    } else if (arg === "--timestamp") {
      const value = argv[++i];
      if (!value) throw new Error("--timestamp requires an ISO-8601 value");
      args.timestamp = value;
    } else if (arg.startsWith("--timestamp=")) {
      args.timestamp = arg.slice("--timestamp=".length);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  if (!isValidIso(args.timestamp)) {
    throw new Error(`Invalid --timestamp (not ISO-8601): ${args.timestamp}`);
  }
  return args;
}

function isValidIso(value) {
  if (typeof value !== "string") return false;
  const t = Date.parse(value);
  return Number.isFinite(t) && /\d{4}-\d{2}-\d{2}T/.test(value);
}

// ---------------------------------------------------------------------------
// Parsing: extract public-table columns + FK relationships from database.ts
// ---------------------------------------------------------------------------

/**
 * Slice out the body of a named section (e.g. "Tables") inside the
 * `public:` object by tracking brace depth from the section's opening `{`.
 * Returns the substring strictly between the matching braces.
 */
function sliceBracedSection(source, sectionName) {
  // Match the section header at 4-space indent: `    Tables: {`
  const header = new RegExp(`\\n    ${sectionName}: \\{\\n`);
  const headerMatch = header.exec(source);
  if (!headerMatch) {
    throw new Error(`Could not locate "${sectionName}:" section in database.ts`);
  }
  // headerMatch[0] ends with the `{\n` newline, so the brace is the 2nd-to-last char.
  const openBraceIndex = headerMatch.index + headerMatch[0].length - 2; // the `{`
  let depth = 0;
  for (let i = openBraceIndex; i < source.length; i++) {
    const ch = source[i];
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        return source.slice(openBraceIndex + 1, i);
      }
    }
  }
  throw new Error(`Unbalanced braces while slicing "${sectionName}" section`);
}

/**
 * Within the Tables section body, split into individual table blocks keyed by
 * table name. Each table block is opened by `      <name>: {` at 6-space indent
 * and closed by the matching brace. Returns Map<tableName, blockBody>.
 */
function splitTableBlocks(tablesBody) {
  const blocks = new Map();
  const openRe = /^      ([a-z_][a-z0-9_]*): \{$/gm;
  let m;
  while ((m = openRe.exec(tablesBody)) !== null) {
    const name = m[1];
    const openBraceIndex = m.index + m[0].length - 1; // position of `{`
    let depth = 0;
    let end = -1;
    for (let i = openBraceIndex; i < tablesBody.length; i++) {
      const ch = tablesBody[i];
      if (ch === "{") depth++;
      else if (ch === "}") {
        depth--;
        if (depth === 0) {
          end = i;
          break;
        }
      }
    }
    if (end === -1) {
      throw new Error(`Unbalanced braces in table block "${name}"`);
    }
    blocks.set(name, tablesBody.slice(openBraceIndex + 1, end));
    openRe.lastIndex = end; // resume scanning after this block
  }
  return blocks;
}

/**
 * Extract the `Row: { ... }` columns from a table block body.
 * Returns Array<{ name, type, nullable }>.
 */
function parseRowColumns(blockBody) {
  const rowRe = /\n        Row: \{\n/;
  const rowMatch = rowRe.exec(blockBody);
  if (!rowMatch) return [];
  // rowMatch[0] ends with the `{\n` newline, so the brace is the 2nd-to-last char.
  const openBraceIndex = rowMatch.index + rowMatch[0].length - 2;
  let depth = 0;
  let end = -1;
  for (let i = openBraceIndex; i < blockBody.length; i++) {
    const ch = blockBody[i];
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  if (end === -1) return [];
  const rowBody = blockBody.slice(openBraceIndex + 1, end);

  const columns = [];
  // Columns are emitted one per line at 10-space indent: `          name: type`
  // (Row keys are never optional in Supabase Row types; nullability is encoded
  // in the type via `| null`.)
  const colRe = /^          ([a-z_][a-z0-9_]*)(\??): (.+?)$/gm;
  let cm;
  while ((cm = colRe.exec(rowBody)) !== null) {
    const name = cm[1];
    const type = cm[3].trim().replace(/,$/, "").trim();
    const nullable = /\|\s*null\b/.test(type) || cm[2] === "?";
    columns.push({ name, type, nullable });
  }
  return columns;
}

/**
 * Extract FK edges from a table block's `Relationships: [ ... ]` array.
 * Returns Array<{ columns: string[], referencedRelation: string }>.
 */
function parseRelationships(blockBody) {
  const relRe = /\n        Relationships: \[/;
  const relMatch = relRe.exec(blockBody);
  if (!relMatch) return [];
  const openBracketIndex = relMatch.index + relMatch[0].length - 1; // the `[`
  let depth = 0;
  let end = -1;
  for (let i = openBracketIndex; i < blockBody.length; i++) {
    const ch = blockBody[i];
    if (ch === "[") depth++;
    else if (ch === "]") {
      depth--;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  if (end === -1) return [];
  const relBody = blockBody.slice(openBracketIndex + 1, end);

  // Each relationship object has exactly one `columns: [...]` then one
  // `referencedRelation: "..."` in source order, so collect both in order and
  // zip by position.
  const cols = [];
  const colsRe = /columns: \[([^\]]*)\]/g;
  let cm;
  while ((cm = colsRe.exec(relBody)) !== null) {
    const list = cm[1]
      .split(",")
      .map((s) => s.trim().replace(/^"|"$/g, ""))
      .filter(Boolean);
    cols.push(list);
  }
  const refs = [];
  const refRe = /referencedRelation: "([^"]+)"/g;
  let rm;
  while ((rm = refRe.exec(relBody)) !== null) {
    refs.push(rm[1]);
  }

  const edges = [];
  const count = Math.min(cols.length, refs.length);
  for (let i = 0; i < count; i++) {
    edges.push({ columns: cols[i], referencedRelation: refs[i] });
  }
  return edges;
}

function parseDatabase(source) {
  const tablesBody = sliceBracedSection(source, "Tables");
  const blocks = splitTableBlocks(tablesBody);
  const tables = [];
  for (const [name, body] of blocks) {
    const columns = parseRowColumns(body);
    const relationships = parseRelationships(body);
    tables.push({ name, columns, relationships });
  }
  tables.sort((a, b) => a.name.localeCompare(b.name));
  return tables;
}

// ---------------------------------------------------------------------------
// Rendering: OKF markdown docs
// ---------------------------------------------------------------------------

const KNOWN_TABLE_SET = new Set();

function escapeForYaml(value) {
  // Wrap in double quotes and escape embedded quotes/backslashes.
  return `"${String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/** Distinct referenced tables (FK targets) for a table, excluding self. */
function uniqueReferencedTables(table) {
  const set = new Set();
  for (const edge of table.relationships) {
    if (edge.referencedRelation && edge.referencedRelation !== table.name) {
      set.add(edge.referencedRelation);
    }
  }
  return Array.from(set).sort();
}

/** Deterministic templated description for a table. */
function describeTable(table) {
  const colCount = table.columns.length;
  const refs = uniqueReferencedTables(table);
  const refSentence =
    refs.length > 0 ? ` References ${refs.join(", ")}.` : " No outbound foreign keys.";
  return `Postgres table \`${table.name}\`: ${colCount} column${colCount === 1 ? "" : "s"}.${refSentence}`;
}

/** Lightweight domain tag inferred from the table name prefix. */
function domainTag(name) {
  const prefixes = [
    "ai",
    "alumni",
    "mentorship",
    "mentor",
    "mentee",
    "donation",
    "stripe",
    "linkedin",
    "event",
    "chat",
    "message",
    "user",
    "organization",
    "org",
    "enterprise",
    "form",
    "notification",
  ];
  for (const p of prefixes) {
    if (name === p || name.startsWith(`${p}_`)) return p;
  }
  return null;
}

function renderTableDoc(table, timestamp) {
  const refs = uniqueReferencedTables(table);
  const domain = domainTag(table.name);
  const tags = ["db", "schema"];
  if (domain) tags.push(domain);

  const lines = [];
  lines.push("---");
  lines.push("type: db-table");
  lines.push(`title: ${escapeForYaml(table.name)}`);
  lines.push(`description: ${escapeForYaml(describeTable(table))}`);
  lines.push(`resource: ${RESOURCE_PATH}`);
  lines.push(`tags: [${tags.join(", ")}]`);
  lines.push(`timestamp: ${timestamp}`);
  lines.push("---");
  lines.push("");
  lines.push(`# ${table.name}`);
  lines.push("");
  lines.push(describeTable(table));
  lines.push("");
  lines.push("## Columns");
  lines.push("");
  if (table.columns.length === 0) {
    lines.push("_No columns parsed._");
  } else {
    lines.push("| Column | Type | Nullable |");
    lines.push("| --- | --- | --- |");
    for (const col of table.columns) {
      const type = col.type.replace(/\|/g, "\\|");
      lines.push(`| \`${col.name}\` | \`${type}\` | ${col.nullable ? "yes" : "no"} |`);
    }
  }
  lines.push("");
  lines.push("## Related tables");
  lines.push("");
  if (refs.length === 0) {
    lines.push("_No outbound foreign keys._");
  } else {
    for (const ref of refs) {
      // Only link to docs we actually emit (base tables). FK targets that are
      // views are listed as plain text so links never dangle.
      if (KNOWN_TABLE_SET.has(ref)) {
        lines.push(`- [${ref}](./${ref}.md)`);
      } else {
        lines.push(`- ${ref} (view or external relation)`);
      }
    }
  }
  lines.push("");
  return lines.join("\n");
}

function renderIndex(tables, timestamp) {
  const lines = [];
  lines.push("---");
  lines.push("type: index");
  lines.push(`title: ${escapeForYaml("Database schema OKF bundle")}`);
  lines.push(
    `description: ${escapeForYaml(
      `OKF bundle of ${tables.length} Postgres tables generated from ${RESOURCE_PATH}.`
    )}`
  );
  lines.push(`resource: ${RESOURCE_PATH}`);
  lines.push("tags: [db, schema, index]");
  lines.push(`timestamp: ${timestamp}`);
  lines.push("---");
  lines.push("");
  lines.push("# Database schema OKF bundle");
  lines.push("");
  lines.push(
    `Generated from \`${RESOURCE_PATH}\`. ${tables.length} public tables. ` +
      "Each table doc links to the tables it references via foreign keys; those " +
      "links form the OKF graph. Regenerate with `bun run gen:db-okf`."
  );
  lines.push("");
  lines.push("## Tables");
  lines.push("");
  for (const table of tables) {
    const colCount = table.columns.length;
    lines.push(
      `- [${table.name}](./${table.name}.md) — ${colCount} column${colCount === 1 ? "" : "s"}`
    );
  }
  lines.push("");
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Self-consistency assertions (inline validator)
// ---------------------------------------------------------------------------

const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---\n/;

function readFrontmatter(content) {
  const m = FRONTMATTER_RE.exec(content);
  if (!m) return null;
  const fm = {};
  for (const line of m[1].split("\n")) {
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    fm[key] = value;
  }
  return fm;
}

/**
 * Assert every emitted doc has valid frontmatter (with a `type`) and that every
 * intra-bundle markdown link resolves to a file in the bundle. Throws on the
 * first inconsistency; returns a summary on success.
 */
function assertBundleConsistent(dir) {
  if (!existsSync(dir)) {
    throw new Error(`Bundle directory does not exist: ${dir}`);
  }
  const files = readdirSync(dir).filter((f) => f.endsWith(".md"));
  if (files.length === 0) {
    throw new Error(`Bundle directory has no markdown docs: ${dir}`);
  }
  const present = new Set(files);
  const linkRe = /\]\(\.\/([^)]+\.md)\)/g;
  let checkedLinks = 0;

  for (const file of files) {
    const content = readFileSync(join(dir, file), "utf8");
    const fm = readFrontmatter(content);
    if (!fm) {
      throw new Error(`Missing/invalid frontmatter fence in ${file}`);
    }
    if (!fm.type) {
      throw new Error(`Missing required \`type\` in frontmatter of ${file}`);
    }
    if (file === "index.md" && fm.type !== "index") {
      throw new Error(`index.md must have type "index", got "${fm.type}"`);
    }
    if (file !== "index.md" && fm.type !== "db-table") {
      throw new Error(`Unexpected type "${fm.type}" in ${file} (expected db-table)`);
    }
    if (!fm.title || !fm.description || !fm.resource || !fm.timestamp) {
      throw new Error(
        `Incomplete frontmatter (need title/description/resource/timestamp) in ${file}`
      );
    }
    let lm;
    linkRe.lastIndex = 0;
    while ((lm = linkRe.exec(content)) !== null) {
      const target = lm[1];
      if (!present.has(target)) {
        throw new Error(`Dangling intra-bundle link in ${file}: ./${target}`);
      }
      checkedLinks++;
    }
  }
  return { docCount: files.length, checkedLinks };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.check) {
    const summary = assertBundleConsistent(OUT_DIR);
    console.log(
      `[gen:db-okf] check OK — ${summary.docCount} docs, ${summary.checkedLinks} intra-bundle links resolved`
    );
    return;
  }

  if (args.llm) {
    console.log(
      "[gen:db-okf] --llm requested but LLM-assisted descriptions are not yet wired; " +
        "falling back to deterministic templates (bundle is still valid)."
    );
  }

  const source = readFileSync(DATABASE_TS, "utf8");
  const tables = parseDatabase(source);

  if (tables.length === 0) {
    throw new Error("Parsed 0 tables from database.ts — parser likely broken");
  }

  // Populate the known-table set so FK links only point at emitted docs.
  KNOWN_TABLE_SET.clear();
  for (const t of tables) KNOWN_TABLE_SET.add(t.name);

  // Guard against silently half-parsed docs: every table should have columns.
  const emptyTables = tables.filter((t) => t.columns.length === 0);
  if (emptyTables.length > 0) {
    throw new Error(
      `Parser produced ${emptyTables.length} table(s) with 0 columns: ` +
        emptyTables.map((t) => t.name).join(", ")
    );
  }

  // Clean + recreate the output dir so removed tables don't leave stale docs.
  if (existsSync(OUT_DIR)) {
    rmSync(OUT_DIR, { recursive: true, force: true });
  }
  mkdirSync(OUT_DIR, { recursive: true });

  for (const table of tables) {
    writeFileSync(join(OUT_DIR, `${table.name}.md`), renderTableDoc(table, args.timestamp), "utf8");
  }
  writeFileSync(join(OUT_DIR, "index.md"), renderIndex(tables, args.timestamp), "utf8");

  // Inline self-consistency check on what we just wrote.
  const summary = assertBundleConsistent(OUT_DIR);

  const totalCols = tables.reduce((sum, t) => sum + t.columns.length, 0);
  console.log(
    `[gen:db-okf] wrote ${tables.length} table docs + index.md to docs/db/okf ` +
      `(${totalCols} columns total)`
  );
  console.log(
    `[gen:db-okf] self-consistency OK — ${summary.docCount} docs, ${summary.checkedLinks} intra-bundle links resolved`
  );
}

try {
  main();
} catch (err) {
  console.error(`[gen:db-okf] FAILED: ${err.message}`);
  process.exitCode = 1;
}
