// Verify committed generated types match the linked (development) Supabase project.
// Usage: node scripts/verify-generated-types.mjs
// Requires an active `supabase link` to the development project (see migrate-development.yml).
// Generates into a temporary file and compares against the tracked file WITHOUT
// overwriting the tracked target, so a stale committed file is always detected.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const TARGET = "src/server/supabase/database.types.ts";

let generated;
try {
  generated = execFileSync(
    "supabase",
    ["gen", "types", "typescript", "--linked", "--schema", "public"],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );
} catch (err) {
  console.error("[fail] failed to generate types from linked project:", err.stderr ?? err.message);
  process.exit(1);
}

const committed = readFileSync(TARGET, "utf8");

if (generated !== committed) {
  const dir = mkdtempSync(join(tmpdir(), "albot-types-"));
  const tmp = join(dir, "database.types.ts");
  writeFileSync(tmp, generated);
  console.error(
    `[fail] generated types differ from committed database.types.ts\n` +
      `  committed: ${TARGET}\n  generated: ${tmp}\n` +
      `  regenerate with: npm run db:types`,
  );
  process.exit(1);
}
console.log("[ok] generated types match committed database.types.ts");
