// Verify committed generated types match the linked (development) Supabase project.
// Usage: node scripts/verify-generated-types.mjs
// Requires an active `supabase link` to the development project (see migrate-development.yml).
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const TARGET = "src/server/supabase/database.types.ts";

let generated;
try {
  generated = execFileSync(
    "supabase",
    ["gen", "types", "typescript", "--linked", "--schema", "public"],
    {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
} catch (err) {
  console.error("[fail] failed to generate types from linked project:", err.stderr ?? err.message);
  process.exit(1);
}

const committed = readFileSync(TARGET, "utf8");

if (generated !== committed) {
  console.error(
    "[fail] generated types differ from committed database.types.ts (run `npm run db:types`)",
  );
  process.exit(1);
}
console.log("[ok] generated types match committed database.types.ts");
