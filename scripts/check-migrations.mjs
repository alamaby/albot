// Static check: migration filename/order integrity (no database connection).
// Usage: node scripts/check-migrations.mjs
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const MIGRATIONS_DIR = "supabase/migrations";
const TIMESTAMP_RE = /^\d{14}_[a-z0-9_]+\.sql$/;

const entries = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql"));

let failed = false;

for (const entry of entries) {
  if (!TIMESTAMP_RE.test(entry)) {
    console.error(`[fail] invalid migration filename: ${entry}`);
    failed = true;
  }
}

const sorted = [...entries].sort();
for (let i = 1; i < sorted.length; i++) {
  const prevTs = sorted[i - 1].slice(0, 14);
  const ts = sorted[i].slice(0, 14);
  if (ts <= prevTs) {
    console.error(
      `[fail] migration timestamps not strictly ordered: ${sorted[i - 1]} -> ${sorted[i]}`,
    );
    failed = true;
  }
}

const unique = new Set(sorted);
if (unique.size !== sorted.length) {
  console.error("[fail] duplicate migration filenames detected");
  failed = true;
}

// Empty-body guard (non-empty .sql only)
for (const entry of sorted) {
  const body = readFileSync(join(MIGRATIONS_DIR, entry), "utf8").replace(/--.*$/gm, "");
  if (!body.trim()) {
    console.error(`[fail] empty migration file: ${entry}`);
    failed = true;
  }
}

// Guardrail: every migration file must have an entry in EXPECTED_MIGRATIONS in
// tests/integration/schema.integration.test.ts. The migrate-development
// workflow runs the hosted schema test "records exactly the expected applied
// migrations"; forgetting the entry fails the workflow AFTER the migration is
// already applied to dev (recurring failure: M3, M6 534dee3, 2026-08-20).
const SCHEMA_TEST_PATH = "tests/integration/schema.integration.test.ts";
const schemaTest = readFileSync(join(process.cwd(), SCHEMA_TEST_PATH), "utf8");
const expectedMatch = schemaTest.match(/const EXPECTED_MIGRATIONS = \[([\s\S]*?)\];/);
if (!expectedMatch) {
  console.error(`[fail] cannot find EXPECTED_MIGRATIONS in ${SCHEMA_TEST_PATH}`);
  failed = true;
} else {
  const expected = new Set(
    [...expectedMatch[1].matchAll(/"([0-9]{14})"/g)].map((m) => m[1]),
  );
  for (const entry of sorted) {
    const ts = entry.slice(0, 14);
    if (!expected.has(ts)) {
      console.error(
        `[fail] migration ${entry} is missing from EXPECTED_MIGRATIONS in ${SCHEMA_TEST_PATH}`,
      );
      failed = true;
    }
  }
  for (const ts of expected) {
    if (!sorted.some((entry) => entry.startsWith(ts))) {
      console.error(
        `[fail] EXPECTED_MIGRATIONS entry ${ts} has no matching migration file`,
      );
      failed = true;
    }
  }
}

if (failed) {
  process.exit(1);
}
console.log(`[ok] ${sorted.length} migration(s) pass filename/order checks`);
