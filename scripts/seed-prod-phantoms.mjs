// Production seeding wrapper for remaining phantom provider configs.
//
// Seeds the two pollinations configs (reasoning gpt-oss + image flux) with one
// POLLINATIONS_API_KEY and the four bynara_image base configs (agnes 2.0/2.1,
// grok, nano-banana) with one BYNARA_API_KEY, against the production database.
// After running, all formerly-phantom prod configs become eligible for
// selection (round_robin reasoning pool widens from 8 to 9; image priority
// failover gains 4 more eligible fallbacks below Pixazo).
//
// Reads secrets (SUPABASE_URL_PROD, SUPABASE_SECRET_KEY_PROD,
// PROVIDER_KEY_ENCRYPTION_KEY, POLLINATIONS_API_KEY, BYNARA_API_KEY) from .env
// via Node — never via shell echo or grep — and invokes
// scripts/upsert-provider-key.mjs six times. All secret values stay inside the
// Node process env. Only key fingerprints and config ids are printed.
//
// Usage:
//   node scripts/seed-prod-phantoms.mjs
//
// Safety: refuses to run if SUPABASE_URL does not point to the repository-
// reviewed production project ref pcexxtckvwmiquseznaz.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const PROD_PROJECT_REF = "pcexxtckvwmiquseznaz";
const PROD_HOST = `https://${PROD_PROJECT_REF}.supabase.co`;

// Two pollinations configs share one POLLINATIONS_API_KEY (same provider,
// same account). The reasoning and image endpoints are different base_urls
// registered in the adapter registry, but the key is the same bearer token.
const POLLINATIONS_ROWS = [
  { adapterType: "pollinations", model: "gpt-oss", capability: "reasoning" },
  { adapterType: "pollinations_image", model: "flux", capability: "image_generation" },
];

// Four bynara_image base configs share one BYNARA_API_KEY — the same key
// already used by the four bynara_*f picker configs seeded by
// seed-prod-bynara.mjs. The base configs are the underlying image models
// (priority 160-163) that sit below the picker configs (priority 200-203) in
// the priority_failover walk.
const BYNARA_IMAGE_ROWS = [
  { adapterType: "bynara_image", model: "agnes-image-2.0-flash", capability: "image_generation" },
  { adapterType: "bynara_image", model: "agnes-image-2.1-flash", capability: "image_generation" },
  { adapterType: "bynara_image", model: "grok-imagine", capability: "image_generation" },
  { adapterType: "bynara_image", model: "nano-banana-pro", capability: "image_generation" },
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

  const pollinationsKey = fileEnv.POLLINATIONS_API_KEY ?? process.env.POLLINATIONS_API_KEY;
  if (!pollinationsKey) fail("POLLINATIONS_API_KEY missing in .env");

  const bynaraImageKey = fileEnv.BYNARA_API_KEY ?? process.env.BYNARA_API_KEY;
  if (!bynaraImageKey) fail("BYNARA_API_KEY missing in .env");

  // Build child env: never put secret values into our own stdout; we just
  // forward them as env overrides to the helper via spawnSync.
  const baseChildEnv = {
    ...process.env,
    SUPABASE_URL: supabaseUrl,
    SUPABASE_SECRET_KEY: srk,
    PROVIDER_KEY_ENCRYPTION_KEY: encKey,
  };

  const plan = [
    ...POLLINATIONS_ROWS.map((r) => ({
      ...r,
      envKey: "POLLINATIONS_API_KEY",
      key: pollinationsKey,
    })),
    ...BYNARA_IMAGE_ROWS.map((r) => ({ ...r, envKey: "BYNARA_API_KEY", key: bynaraImageKey })),
  ];

  console.log(`[info] target: ${PROD_HOST}`);
  console.log(`[info] seeding ${plan.length} phantom rows (2 pollinations + 4 bynara_image)`);

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
      env: { ...baseChildEnv, [row.envKey]: row.key },
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
  console.log(`[ok] seeded ${okCount}/${plan.length} phantom rows in production`);
}

main();
