// Production seeding wrapper for Bynara providers.
//
// Reads all secrets (SUPABASE_URL_PROD, SUPABASE_SECRET_KEY_PROD,
// PROVIDER_KEY_ENCRYPTION_KEY, BYNARA_API_KEY, BYNARA_REASONING_API_KEY)
// from .env via Node — never via shell echo or grep — and invokes
// scripts/upsert-provider-key.mjs ten times to provision 10 Bynara rows
// (6 reasoning, 4 image picker) against the production database.
//
// All secret values stay inside the Node process env. They are passed
// to the child process as env overrides; nothing is ever written to
// stdout/stderr. Only key fingerprints and config ids are printed.
//
// Usage:
//   node scripts/seed-prod-bynara.mjs
//
// Safety: refuses to run if SUPABASE_URL in environment is a dev URL or
// if SUPABASE_URL_PROD does not point to the repository-reviewed project
// ref pcexxtckvwmiquseznaz.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const PROD_PROJECT_REF = "pcexxtckvwmiquseznaz";
const PROD_HOST = `https://${PROD_PROJECT_REF}.supabase.co`;

const REASONING_ROWS = [
  { adapterType: "bynara", model: "laguna-s-2.1" },
  { adapterType: "bynara_ag25", model: "agnes-2.5-flash" },
  { adapterType: "bynara_mm3f", model: "minimax-m3-free" },
  { adapterType: "bynara_mm35", model: "mistral-medium-3-5" },
  { adapterType: "bynara_ms12", model: "muse-spark-1.2-contributor-free" },
  { adapterType: "bynara_qw38", model: "qwen3.8-27b" },
];

const IMAGE_ROWS = [
  { adapterType: "bynara_a20f", model: "agnes-image-2.0-flash" },
  { adapterType: "bynara_a21f", model: "agnes-image-2.1-flash" },
  { adapterType: "bynara_grok", model: "grok-imagine" },
  { adapterType: "bynara_nbn", model: "nano-banana-pro" },
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

  const bynaraImageKey = fileEnv.BYNARA_API_KEY ?? process.env.BYNARA_API_KEY;
  const bynaraReasoningKey =
    fileEnv.BYNARA_REASONING_API_KEY ?? process.env.BYNARA_REASONING_API_KEY;
  if (!bynaraImageKey) fail("BYNARA_API_KEY missing");
  if (!bynaraReasoningKey) fail("BYNARA_REASONING_API_KEY missing");

  // Build child env: never put secret values into our own stdout; we just
  // forward them as env overrides to the helper via spawnSync.
  const childEnv = {
    ...process.env,
    SUPABASE_URL: supabaseUrl,
    SUPABASE_SECRET_KEY: srk,
    PROVIDER_KEY_ENCRYPTION_KEY: encKey,
    BYNARA_API_KEY: bynaraImageKey,
    BYNARA_REASONING_API_KEY: bynaraReasoningKey,
  };

  const plan = [
    ...REASONING_ROWS.map((r) => ({
      ...r,
      capability: "reasoning",
      envKey: "BYNARA_REASONING_API_KEY",
    })),
    ...IMAGE_ROWS.map((r) => ({ ...r, capability: "image_generation", envKey: "BYNARA_API_KEY" })),
  ];

  console.log(`[info] target: ${PROD_HOST}`);
  console.log(`[info] seeding ${plan.length} Bynara rows`);

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
  console.log(`[ok] seeded ${okCount}/${plan.length} Bynara rows in production`);
}

main();
