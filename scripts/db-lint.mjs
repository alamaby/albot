// Static SQL guardrail scan for migrations (no database connection).
// Scans for destructive/risky statements and plaintext-like secrets.
// This is a guardrail, not semantic proof — hosted schema assertions remain mandatory.
// Usage: node scripts/db-lint.mjs
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const MIGRATIONS_DIR = "supabase/migrations";

// Strip SQL comments and string literals so statement-level patterns do not match
// documentation, function bodies wrapped in string literals, or prose.
function stripCommentsAndStrings(sql) {
  let out = "";
  let i = 0;
  const n = sql.length;
  while (i < n) {
    const c = sql[i];
    const next = sql[i + 1];
    // line comment
    if (c === "-" && next === "-") {
      while (i < n && sql[i] !== "\n") {
        out += " ";
        i++;
      }
      continue;
    }
    // block comment
    if (c === "/" && next === "*") {
      out += "  ";
      i += 2;
      while (i + 1 < n && !(sql[i] === "*" && sql[i + 1] === "/")) {
        out += " ";
        i++;
      }
      i += 2;
      continue;
    }
    // dollar-quoted string ($$ or $tag$)
    if (c === "$") {
      const m = sql.slice(i).match(/^\$[A-Za-z0-9_]*\$/);
      if (m) {
        const tag = m[0];
        const end = sql.indexOf(tag, i + tag.length);
        const stop = end === -1 ? n : end + tag.length;
        out += " ".repeat(stop - i);
        i = stop;
        continue;
      }
    }
    // single-quoted string with '' escape
    if (c === "'") {
      out += " ";
      i++;
      while (i < n) {
        if (sql[i] === "'") {
          if (sql[i + 1] === "'") {
            out += "  ";
            i += 2;
            continue;
          }
          out += " ";
          i++;
          break;
        }
        out += " ";
        i++;
      }
      continue;
    }
    // double-quoted identifier
    if (c === '"') {
      out += " ";
      i++;
      while (i < n && sql[i] !== '"') {
        out += " ";
        i++;
      }
      i++;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

const FORBIDDEN_PATTERNS = [
  { name: "drop", re: /\bdrop\b/i },
  { name: "truncate", re: /\btruncate\b/i },
  { name: "destructive delete DML", re: /\bdelete\s+from\b/i },
  { name: "alter column type", re: /\balter\s+column\b[\s\S]*?\btype\s+(?!jsonb)/i },
  { name: "set not null", re: /\balter\s+column\b[\s\S]*?\bset\s+not\s+null\b/i },
  { name: "rename", re: /\brename\b/i },
  { name: "create policy", re: /\bcreate\s+policy\b/i },
  { name: "set role", re: /\bset\s+role\b/i },
  {
    name: "dynamic execute (non-format)",
    re: /\bexecute\s+(?!format\s*\()(?!function\b)(?!on\b)/i,
  },
  {
    name: "broad grant anon/authenticated",
    re: /\bgrant\b[\s\S]*?\bto\s+(public|anon|authenticated)\b/i,
  },
  {
    name: "alter default privileges to api roles",
    re: /\balter\s+default\s+privileges\b[\s\S]*?\bto\s+(public|anon|authenticated)\b/i,
  },
];

const SECRET_PATTERNS = [
  { name: "openai-like key", re: /sk-[A-Za-z0-9_-]{16,}/ },
  { name: "JWT-like token", re: /eyJ[A-Za-z0-9_.-]{20,}/ },
  { name: "telegram bot token", re: /\b\d{8,}:[A-Za-z0-9_-]{30,}\b/ },
  { name: "service role key hint", re: /service_role.*(eyJ|=\s*["'][A-Za-z0-9])/i },
  { name: "supabase secret key hint", re: /secret_key.*(sb_secret_|=\s*["']sb_)/i },
  { name: "supabase sb_secret_ literal", re: /sb_secret_[A-Za-z0-9_-]{16,}/ },
];

let failed = false;

for (const file of readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql"))) {
  const raw = readFileSync(join(MIGRATIONS_DIR, file), "utf8");
  const stripped = stripCommentsAndStrings(raw);

  for (const { name, re } of FORBIDDEN_PATTERNS) {
    const m = stripped.match(re);
    if (m) {
      console.error(
        `[fail] ${file}: forbidden pattern "${name}" near: ${m[0].trim().slice(0, 80)}`,
      );
      failed = true;
    }
  }

  for (const { name, re } of SECRET_PATTERNS) {
    if (raw.match(re)) {
      console.error(`[fail] ${file}: plaintext-like secret detected (${name})`);
      failed = true;
    }
  }
}

if (failed) process.exit(1);
console.log("[ok] migration static SQL scan passed");
