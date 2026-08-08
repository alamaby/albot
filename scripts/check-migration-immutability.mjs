// Reject modification/deletion/rename of migration files already present on the
// base branch. Only new timestamped forward-fix migration files are allowed.
// Usage: node scripts/check-migration-immutability.mjs <base-ref> [head-ref]
//   base-ref: git ref of the branch being merged into (e.g. origin/main or the
//             pull request base SHA)
//   head-ref: defaults to HEAD
import { execFileSync } from "node:child_process";

const baseRef = process.argv[2];
if (!baseRef) {
  console.error("usage: node scripts/check-migration-immutability.mjs <base-ref> [head-ref]");
  process.exit(2);
}
const headRef = process.argv[3] ?? "HEAD";

let diff;
try {
  diff = execFileSync(
    "git",
    ["diff", "--name-status", `${baseRef}...${headRef}`, "--", "supabase/migrations"],
    {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
} catch (err) {
  console.error("[fail] cannot diff migrations against base:", err.stderr ?? err.message);
  process.exit(1);
}

const lines = diff
  .split(/\r?\n/)
  .map((l) => l.trim())
  .filter(Boolean);

let failed = false;
for (const line of lines) {
  const match = line.match(/^([MADRCU])\s+(.+)$/);
  if (!match) continue;
  const [status, file] = [match[1], match[2]];
  if (status !== "A") {
    console.error(
      `[fail] applied migration must be immutable: ${status} ${file} (add new timestamped migration instead)`,
    );
    failed = true;
  }
}

if (failed) process.exit(1);
console.log(`[ok] migration immutability: only new files in ${lines.length} change(s)`);
