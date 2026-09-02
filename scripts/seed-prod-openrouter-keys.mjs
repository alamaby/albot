// Production seeding wrapper for OpenRouter free-tier reasoning providers.
//
// Reads secrets (SUPABASE_URL_PROD, SUPABASE_SECRET_KEY_PROD,
// PROVIDER_KEY_ENCRYPTION_KEY, OPENROUTER_API_KEY) from .env via Node — never
// via shell echo or grep — and invokes scripts/upsert-provider-key.mjs five
// times to provision the five OpenRouter free reasoning rows against the
// production database. One OPENROUTER_API_KEY is reused across all five
// configs (the AAD binding albot/provider-key/v1/{configId} is per-config, so
// each config stores its own encrypted copy of the same plaintext).
//
// All secret values stay inside the Node process env. They are passed to the
// child process as env overrides; nothing is ever written to stdout/stderr.
// Only key fingerprints and config ids are printed.
//
// Usage:
//   node scripts/seed-prod-openrouter-keys.mjs
//
// Safety: refuses to run if SUPABASE_URL in environment is a dev URL or if
// SUPABASE_URL_PROD does not point to the repository-reviewed production
// project ref pcexxtckvwmiquseznaz.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const PROD_PROJECT_REF = "pcexxtckvwmiquseznaz";
const PROD_HOST = `https://${PROD_PROJECT_REF}.supabase.co`;

// Five OpenRouter free reasoning configs. Each is a phantom in prod until this
// script seeds its key, after which all five rejoin the round_robin rotation
// (post selector fix) alongside Cloudflare + Bynara laguna/nemotron.
const OPENROUTER_ROWS = [
  { adapterType: "openrouter_free", model: "openrouter/free" },
  { adapterType: "openrouter_ing", model: "inclusionai/ling-3.0-flash-fin:free" },
  { adapterType: "openrouter_laguna", model: "poolside/laguna-s-2.1:free" },
  { adapterType: "openrouter_glm", model: "z-ai/glm-5.2:free" },
  { adapterType: "openrouter_m3", model: "minimax/minimax-m3:free" },
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

  const supabaseUrl =
    process.env.SUPABASE_URL ?? process.env.SUPABASE_URL_PROD ?? fileEnv.SUPABASE_URL_PROD;
  if (!supabaseUrl) fail("SUPABASE_URL not set (and SUPABASE_URL_PROD missing in .env)");

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

  const srk =
    process.env.SUPABASE_SECRET_KEY ??
    process.env.SUPABASE_SECRET_KEY_PROD ??
    fileEnv.SUPABASE_SECRET_KEY_PROD;
  if (!srk) fail("SUPABASE_SECRET_KEY (or _PROD) missing");

  const encKey = fileEnv.PROVIDER_KEY_ENCRYPTION_KEY_PROD ?? fileEnv.PROVIDER_KEY_ENCRYPTION_KEY;
  if (!encKey) fail("PROVIDER_KEY_ENCRYPTION_KEY (or _PROD) missing in .env");

  // OpenRouter API key. Accept either OPENROUTER_API_KEY (general) or
  // OPENROUTER_FREE_API_KEY (dedicated free-tier key) — the latter is preferred
  // when present so a paid key is not accidentally bound to free-tier configs.
  const openrouterKey =
    fileEnv.OPENROUTER_FREE_API_KEY ??
    process.env.OPENROUTER_FREE_API_KEY ??
    fileEnv.OPENROUTER_API_KEY ??
    process.env.OPENROUTER_API_KEY;
  if (!openrouterKey) {
    fail("OPENROUTER_API_KEY missing (set OPENROUTER_API_KEY or OPENROUTER_FREE_API_KEY in .env)");
  }

  // Build child env: never put secret values into our own stdout; we just
  // forward them as env overrides to the helper via spawnSync.
  const childEnv = {
    ...process.env,
    SUPABASE_URL: supabaseUrl,
    SUPABASE_SECRET_KEY: srk,
    PROVIDER_KEY_ENCRYPTION_KEY: encKey,
    OPENROUTER_API_KEY: openrouterKey,
  };

  const plan = OPENROUTER_ROWS.map((r) => ({
    ...r,
    capability: "reasoning",
    envKey: "OPENROUTER_API_KEY",
  }));

  console.log(`[info] target: ${PROD_HOST}`);
  console.log(`[info] seeding ${plan.length} OpenRouter free reasoning rows`);

  let okCount = 0;
  for (const row of plan) {
    const args = [
      "scripts/upsert-provider-key.mjs",
      row.adapterType,
      row.model,
      "--capability",
      row.capability,
      "--env-key",
      row.envKey,
    ];
    const result = spawnSync("node", args, {
      env: childEnv,
      stdio: ["ignore", "inherit", "inherit"],
      encoding: "utf8",
    });
    if (result.status !== 0) {
      fail(
        `upsert failed for ${row.adapterType}/${row.model} (capability=${row.capability}); ` +
          `child exited with status ${result.status}`,
      );
    }
    okCount += 1;
  }
  console.log(`[ok] seeded ${okCount}/${plan.length} OpenRouter rows in production`);
}

main();
