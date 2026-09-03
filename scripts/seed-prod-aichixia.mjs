// Production seeding wrapper for Aichixia image generation providers.
//
// Reads all secrets (SUPABASE_URL_PROD, SUPABASE_SECRET_KEY_PROD,
// PROVIDER_KEY_ENCRYPTION_KEY_PROD, AICHIXIA_API_KEY) from .env via Node —
// never via shell echo or grep — and invokes scripts/upsert-provider-key.mjs
// four times to provision the 4 Aichixia image_generation rows against the
// production database.
//
// All secret values stay inside the Node process env and are forwarded to the
// child process as env overrides; nothing is ever written to stdout/stderr.
// Only key fingerprints and config ids are printed.
//
// Usage:
//   node scripts/seed-prod-aichixia.mjs
//
// Prerequisite: the production database must already contain the 4
// provider_configs rows (adapter_type aichixia_*, model per row) — applied by
// migration 20260903052207 via the migrate-production workflow. If they are
// missing, upsert-provider-key fails with "no provider_configs row found";
// push main and let migrate-production finish first, then re-run this script.
//
// Safety: refuses to run unless the resolved SUPABASE_URL points to the
// repository-reviewed production host (ref pcexxtckvwmiquseznaz).

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const PROD_PROJECT_REF = "pcexxtckvwmiquseznaz";
const PROD_HOST = `https://${PROD_PROJECT_REF}.supabase.co`;

const IMAGE_ROWS = [
  { adapterType: "aichixia_flux2", model: "flux-2-dev" },
  { adapterType: "aichixia_lucid", model: "lucid-origin" },
  { adapterType: "aichixia_phoenix", model: "phoenix-1.0" },
  { adapterType: "aichixia_gemini", model: "gemini-3-pro-image" },
];

function fail(message) {
  console.error(`[error] ${message}`);
  process.exit(1);
}

function parseEnvFile(path) {
  if (!existsSync(path)) return {};
  const content = readFileSync(path, "utf8");
  const out = {};
  for (const line of content.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z0-9_]+)=(.*)$/);
    if (!match) continue;
    const key = match[1];
    let value = match[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

function main() {
  const cwd = process.cwd();
  const fileEnv = { ...parseEnvFile(join(cwd, ".env.local")), ...parseEnvFile(join(cwd, ".env")) };

  // Prefer the explicit _PROD value from .env (deterministic target), falling
  // back to a shell-provided SUPABASE_URL_* — never to a bare process.env
  // SUPABASE_URL, which on this machine is a junk Vercel snapshot in .env.local.
  const supabaseUrl = fileEnv.SUPABASE_URL_PROD ?? process.env.SUPABASE_URL_PROD ?? process.env.SUPABASE_URL;
  if (!supabaseUrl) fail("SUPABASE_URL_PROD missing in .env (and no SUPABASE_URL_PROD in environment)");

  if (supabaseUrl !== PROD_HOST) {
    const ref = supabaseUrl.match(/^https:\/\/([a-z0-9]+)\.supabase\.co/)?.[1];
    if (ref !== PROD_PROJECT_REF) {
      fail(
        `refusing to run: SUPABASE_URL points to "${ref ?? supabaseUrl}", ` +
          `expected prod host ${PROD_HOST} (ref ${PROD_PROJECT_REF}). ` +
          `This script is for production seeding only.`,
      );
    }
  }

  const srk = fileEnv.SUPABASE_SECRET_KEY_PROD ?? process.env.SUPABASE_SECRET_KEY_PROD;
  if (!srk) fail("SUPABASE_SECRET_KEY_PROD missing in .env");

  const encKey = fileEnv.PROVIDER_KEY_ENCRYPTION_KEY_PROD ?? fileEnv.PROVIDER_KEY_ENCRYPTION_KEY;
  if (!encKey) fail("PROVIDER_KEY_ENCRYPTION_KEY (or _PROD) missing in .env");

  const aichixiaKey = fileEnv.AICHIXIA_API_KEY ?? process.env.AICHIXIA_API_KEY;
  if (!aichixiaKey) fail("AICHIXIA_API_KEY missing in .env");

  // Build child env: forward secrets as env overrides; never print them.
  const childEnv = {
    ...process.env,
    SUPABASE_URL: supabaseUrl,
    SUPABASE_SECRET_KEY: srk,
    PROVIDER_KEY_ENCRYPTION_KEY: encKey,
    AICHIXIA_API_KEY: aichixiaKey,
  };

  console.log(`[info] target: ${PROD_HOST}`);
  console.log(`[info] seeding ${IMAGE_ROWS.length} Aichixia image rows`);

  let okCount = 0;
  for (const row of IMAGE_ROWS) {
    const args = [
      "scripts/upsert-provider-key.mjs",
      row.adapterType,
      row.model,
      "--capability",
      "image_generation",
      "--env-key",
      "AICHIXIA_API_KEY",
    ];
    const result = spawnSync("node", args, {
      env: childEnv,
      stdio: ["ignore", "inherit", "inherit"],
      encoding: "utf8",
    });
    if (result.status !== 0) {
      fail(
        `upsert failed for ${row.adapterType}/${row.model} (capability=image_generation); ` +
          `child exited with status ${result.status}. ` +
          `If the error is "no provider_configs row found", push main and let ` +
          `migrate-production finish first, then re-run this script.`,
      );
    }
    okCount += 1;
  }
  console.log(`[ok] seeded ${okCount}/${IMAGE_ROWS.length} Aichixia image rows in production`);
}

main();
