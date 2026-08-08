// Static SQL guardrail scan for migrations (no database connection).
// Scans for destructive statements, broad grants, and plaintext-like secrets.
// This is a guardrail, not semantic proof — hosted schema assertions remain mandatory.
// Usage: node scripts/db-lint.mjs
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const MIGRATIONS_DIR = "supabase/migrations";

const FORBIDDEN_PATTERNS = [
  { name: "drop", re: /\bdrop\b/i },
  { name: "truncate", re: /\btruncate\b/i },
  { name: "destructive delete DML", re: /\bdelete\s+from\b/i },
  {
    name: "broad grant anon/authenticated",
    re: /\bgrant\b[\s\S]*?\bto\s+(public|anon|authenticated)\b/i,
  },
  {
    name: "grant usage schema to anon",
    re: /grant\s+usage[\s\S]*?\bto\s+(public|anon|authenticated)\b/i,
  },
];

const SECRET_PATTERNS = [
  { name: "openai-like key", re: /sk-[A-Za-z0-9_-]{16,}/ },
  { name: "JWT-like token", re: /eyJ[A-Za-z0-9_.-]{20,}/ },
  { name: "telegram bot token", re: /\b\d{8,}:[A-Za-z0-9_-]{30,}\b/ },
  { name: "service role key hint", re: /service_role.*(eyJ|=\s*["'][A-Za-z0-9])/i },
];

let failed = false;

for (const file of readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql"))) {
  const content = readFileSync(join(MIGRATIONS_DIR, file), "utf8");

  for (const { name, re } of FORBIDDEN_PATTERNS) {
    const m = content.match(re);
    if (m) {
      console.error(
        `[fail] ${file}: forbidden pattern "${name}" near: ${m[0].trim().slice(0, 80)}`,
      );
      failed = true;
    }
  }

  for (const { name, re } of SECRET_PATTERNS) {
    const m = content.match(re);
    if (m) {
      console.error(`[fail] ${file}: plaintext-like secret detected (${name})`);
      failed = true;
    }
  }
}

if (failed) {
  process.exit(1);
}
console.log("[ok] migration static SQL scan passed");
