#!/usr/bin/env node
// Validates the Open Knowledge Format (OKF) frontmatter of a markdown bundle.
//
// Why: docs/agent/ is an OKF bundle whose `resource:` fields point at source
// files. When code is renamed (e.g. lib/falkordb -> lib/people-graph) those
// paths silently rot. This script is the rot-catcher: it asserts every doc has
// valid frontmatter, no misspelled reserved keys, and that every `resource:`
// path (and every index.md bundle link) still resolves on disk.
//
// Usage:
//   node scripts/validate-okf-frontmatter.mjs <dir> [<dir> ...]
//   bun run validate:okf            # -> node scripts/... docs/agent
//
// Exits non-zero with a per-file reason list on any failure; zero when clean.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";

// Repo root is one level up from this script's scripts/ directory.
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// OKF's reserved frontmatter keys. `type` is the only required one.
const RESERVED_KEYS = ["type", "title", "description", "resource", "tags", "timestamp"];
const REQUIRED_KEYS = ["type"];

// Flag keys that look like typos of a reserved key (e.g. `tag`, `timestmp`,
// `resourse`) while leaving genuinely new keys alone. A non-reserved key is a
// likely typo when it is within this edit distance of a reserved key.
const TYPO_EDIT_DISTANCE = 2;

const dirs = process.argv.slice(2);
if (dirs.length === 0) {
  console.error("Usage: node scripts/validate-okf-frontmatter.mjs <dir> [<dir> ...]");
  process.exit(1);
}

for (const dir of dirs) {
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
    console.error(`Not a directory: ${dir}`);
    process.exit(1);
  }
}

// Levenshtein edit distance between two strings (iterative, O(a*b) space-lean).
function editDistance(a, b) {
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const next = Math.min(
        prev[j] + 1, // deletion
        prev[j - 1] + 1, // insertion
        diag + cost // substitution
      );
      diag = prev[j];
      prev[j] = next;
    }
  }
  return prev[b.length];
}

// Split the leading `---` fenced YAML block. Returns { frontmatter, error }.
// The first line must be `---`; the block ends at the next `---` line.
function extractFrontmatter(raw) {
  const lines = raw.split(/\r?\n/);
  if (lines[0]?.trim() !== "---") {
    return { error: "no frontmatter: first line is not '---'" };
  }
  let close = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === "---") {
      close = i;
      break;
    }
  }
  if (close === -1) {
    return { error: "no frontmatter: missing closing '---'" };
  }
  const block = lines.slice(1, close).join("\n");
  let parsed;
  try {
    parsed = yaml.load(block);
  } catch (err) {
    return { error: `frontmatter is not valid YAML: ${err.message}` };
  }
  if (parsed === null || parsed === undefined) {
    return { error: "frontmatter block is empty" };
  }
  if (typeof parsed !== "object" || Array.isArray(parsed)) {
    return { error: "frontmatter must be a YAML mapping" };
  }
  return { frontmatter: parsed };
}

// `resource:` paths may be repo-root-absolute (leading `/`) or relative to the
// doc. Resolve both forms and report whichever exists; return null if neither.
function resolveResourcePath(resource, fileDir) {
  const candidates = resource.startsWith("/")
    ? [path.join(REPO_ROOT, resource.slice(1))]
    : [path.resolve(fileDir, resource), path.join(REPO_ROOT, resource)];
  return candidates.find((c) => fs.existsSync(c)) ?? null;
}

// An ISO-8601 timestamp must both parse to a real Date and look like ISO-8601
// (date, optionally with time/offset) — `new Date()` alone is too lenient.
const ISO_8601 = /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/;
function isIso8601(value) {
  // js-yaml resolves YAML 1.1 timestamps to a Date; an unparseable timestamp
  // stays a string. A real Date is valid as long as it is not Invalid Date.
  if (value instanceof Date) return !Number.isNaN(value.getTime());
  if (typeof value !== "string") return false;
  if (!ISO_8601.test(value)) return false;
  return !Number.isNaN(new Date(value).getTime());
}

// Validate one document's frontmatter. Returns an array of failure strings.
function validateDoc(filePath, frontmatter) {
  const failures = [];
  const fileDir = path.dirname(filePath);
  const keys = Object.keys(frontmatter);

  for (const required of REQUIRED_KEYS) {
    if (!(required in frontmatter)) {
      failures.push(`missing required key '${required}'`);
    }
  }

  for (const key of keys) {
    if (RESERVED_KEYS.includes(key)) continue;
    for (const reserved of RESERVED_KEYS) {
      if (editDistance(key, reserved) <= TYPO_EDIT_DISTANCE) {
        failures.push(`key '${key}' looks like a typo of reserved key '${reserved}'`);
        break;
      }
    }
  }

  if ("tags" in frontmatter && !Array.isArray(frontmatter.tags)) {
    failures.push(`'tags' must be a list, got ${typeof frontmatter.tags}`);
  }

  if ("timestamp" in frontmatter && !isIso8601(frontmatter.timestamp)) {
    failures.push(
      `'timestamp' is not a valid ISO-8601 string: ${JSON.stringify(frontmatter.timestamp)}`
    );
  }

  if ("resource" in frontmatter) {
    const resource = frontmatter.resource;
    if (typeof resource !== "string" || resource.length === 0) {
      failures.push(`'resource' must be a non-empty string`);
    } else if (resolveResourcePath(resource, fileDir) === null) {
      failures.push(`'resource' path does not exist on disk: ${resource}`);
    }
  }

  return failures;
}

// index.md additionally links into the bundle with markdown `[label](target)`
// links. Bundle-internal targets (repo-root-absolute `/docs/...` or relative
// `.md`) must resolve on disk — this catches dangling links after a rename.
function validateIndexLinks(filePath, raw) {
  const failures = [];
  const fileDir = path.dirname(filePath);
  const linkRe = /\]\(([^)]+)\)/g;
  let match;
  while ((match = linkRe.exec(raw)) !== null) {
    const target = match[1].split("#")[0].trim();
    if (target.length === 0) continue;
    // Only check bundle-internal links: absolute /docs/... or relative *.md.
    const isInternalAbsolute = target.startsWith("/docs/");
    const isRelativeMd =
      !target.startsWith("/") && !/^[a-z]+:/i.test(target) && target.endsWith(".md");
    if (!isInternalAbsolute && !isRelativeMd) continue;
    const resolved = isInternalAbsolute
      ? path.join(REPO_ROOT, target.slice(1))
      : path.resolve(fileDir, target);
    if (!fs.existsSync(resolved)) {
      failures.push(`index link target does not exist: ${target}`);
    }
  }
  return failures;
}

let totalFiles = 0;
let failedFiles = 0;
const allDirsLabel = dirs.join(", ");

for (const dir of dirs) {
  const entries = fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith(".md"))
    .map((e) => path.join(dir, e.name))
    .sort();

  for (const filePath of entries) {
    totalFiles++;
    const raw = fs.readFileSync(filePath, "utf8");
    const { frontmatter, error } = extractFrontmatter(raw);

    const failures = [];
    if (error) {
      failures.push(error);
    } else {
      failures.push(...validateDoc(filePath, frontmatter));
      if (path.basename(filePath) === "index.md") {
        failures.push(...validateIndexLinks(filePath, raw));
      }
    }

    if (failures.length > 0) {
      failedFiles++;
      console.error(`✗ ${filePath}`);
      for (const f of failures) {
        console.error(`    - ${f}`);
      }
    }
  }
}

if (failedFiles > 0) {
  console.error(
    `\nOKF validation FAILED: ${failedFiles} of ${totalFiles} file(s) invalid in ${allDirsLabel}`
  );
  process.exit(1);
}

console.log(`✓ OKF valid: ${totalFiles} files in ${allDirsLabel}`);
