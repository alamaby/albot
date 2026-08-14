// Provider config + key provisioning script (development).
//
// Usage (run from repo root, secrets via environment or arguments):
//   node scripts/seed-provider-config.mjs add <adapter_type> <name> <base_url> <model> \
//       <selection_strategy> <priority> <weight> --key <plaintext_key> [--label <label>]
//
// Reads SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / PROVIDER_KEY_ENCRYPTION_KEY from
// the environment (same as the server). Inserts a provider_configs row
// (capability=reasoning, is_active=true) and an encrypted provider_keys row.
// Never prints the plaintext key.
//
// Alternative key input: pass the key via the PROVIDER_KEY arg instead of --key
// so it does not appear in shell history (still an arg; prefer an env var).

import { createClient } from "@supabase/supabase-js";
import { createCipheriv, createHash, randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ADAPTERS = ["openai_compatible"];
const STRATEGIES = ["priority_failover", "weighted"];

function fail(message) {
  console.error(`[error] ${message}`);
  process.exit(1);
}

// Loads the local .env file (gitignored) into process.env without overriding
// variables already set in the shell (same precedence as tests/setup-env.ts).
function loadDotEnv() {
  const file = join(process.cwd(), ".env");
  if (!existsSync(file)) return;
  const content = readFileSync(file, "utf8");
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
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

function resolveEnv(names) {
  for (const name of names) {
    if (process.env[name]) return process.env[name];
  }
  return undefined;
}

function parseEncryptionKey(raw) {
  if (!raw) fail("PROVIDER_KEY_ENCRYPTION_KEY env is required");
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(raw) || raw.length % 4 === 1) {
    fail("PROVIDER_KEY_ENCRYPTION_KEY must be a valid base64 string");
  }
  const decoded = Buffer.from(raw, "base64");
  if (decoded.length !== 32) {
    fail(`PROVIDER_KEY_ENCRYPTION_KEY must decode to 32 bytes, got ${decoded.length}`);
  }
  return decoded;
}

function encryptKey(plaintext, rootKey, providerConfigId) {
  const associatedData = `albot/provider-key/v1/${providerConfigId}`;
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", rootKey, iv);
  cipher.setAAD(Buffer.from(associatedData));
  const ciphertext = Buffer.concat([cipher.update(Buffer.from(plaintext, "utf8")), cipher.final()]);
  const authTag = cipher.getAuthTag();
  const fingerprint = createHash("sha256").update(plaintext, "utf8").digest("hex");
  return {
    key_ciphertext: ciphertext.toString("base64"),
    key_iv: iv.toString("base64"),
    key_auth_tag: authTag.toString("base64"),
    key_fingerprint: fingerprint,
  };
}

async function main() {
  loadDotEnv();
  const [command, adapterType, name, baseUrl, model, strategy, priority, weight] =
    process.argv.slice(2);

  if (command !== "add") {
    fail(
      "usage: node scripts/seed-provider-config.mjs add <adapter_type> <name> <base_url> <model> " +
        "<selection_strategy> <priority> <weight> --key <plaintext_key> [--label <label>]",
    );
  }

  if (!ADAPTERS.includes(adapterType)) {
    fail(`adapter_type must be one of: ${ADAPTERS.join(", ")}`);
  }
  if (!STRATEGIES.includes(strategy)) {
    fail(`selection_strategy must be one of: ${STRATEGIES.join(", ")}`);
  }
  const priorityNum = Number(priority);
  const weightNum = Number(weight);
  if (!Number.isInteger(priorityNum) || priorityNum < 0)
    fail("priority must be a non-negative integer");
  if (!Number.isInteger(weightNum) || weightNum <= 0) fail("weight must be a positive integer");
  if (!/^https:\/\//i.test(baseUrl ?? "")) fail("base_url must start with https://");

  const keyIndex = process.argv.indexOf("--key");
  const envKeyIndex = process.argv.indexOf("--env-key");
  // Precedence: --key arg > --env-key <NAME> > PROVIDER_KEY env.
  let plaintextKey = null;
  if (keyIndex !== -1) {
    plaintextKey = process.argv[keyIndex + 1];
  } else if (envKeyIndex !== -1) {
    plaintextKey = process.env[process.argv[envKeyIndex + 1]] ?? null;
  } else {
    plaintextKey = process.env.PROVIDER_KEY ?? null;
  }
  if (!plaintextKey || plaintextKey.length === 0) {
    fail(
      "plaintext provider key required (--key <key>, --env-key <ENV_VAR_NAME>, or PROVIDER_KEY env)",
    );
  }

  const labelIndex = process.argv.indexOf("--label");
  const label = labelIndex !== -1 ? process.argv[labelIndex + 1] : null;

  const env = {
    SUPABASE_URL: resolveEnv(["SUPABASE_URL", "SUPABASE_URL_DEV"]),
    SUPABASE_SERVICE_ROLE_KEY: resolveEnv([
      "SUPABASE_SERVICE_ROLE_KEY",
      "SUPABASE_SERVICE_ROLE_KEY_DEV",
    ]),
    PROVIDER_KEY_ENCRYPTION_KEY: resolveEnv(["PROVIDER_KEY_ENCRYPTION_KEY"]),
  };
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    fail(
      "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY env vars are required " +
        "(resolves SUPABASE_URL_DEV / SUPABASE_SERVICE_ROLE_KEY_DEV from .env)",
    );
  }
  if (!env.PROVIDER_KEY_ENCRYPTION_KEY) {
    fail("PROVIDER_KEY_ENCRYPTION_KEY env var is required");
  }

  const rootKey = parseEncryptionKey(env.PROVIDER_KEY_ENCRYPTION_KEY);
  const admin = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  // Insert config first; the key references it.
  const { data: config, error: configError } = await admin
    .from("provider_configs")
    .insert({
      capability: "reasoning",
      adapter_type: adapterType,
      name,
      base_url: baseUrl,
      model: model || null,
      settings: {},
      selection_strategy: strategy,
      priority: priorityNum,
      weight: weightNum,
      is_active: true,
    })
    .select("id")
    .single();

  if (configError) fail(`provider config insert failed: ${configError.message}`);
  const configId = config.id;

  const encrypted = encryptKey(plaintextKey, rootKey, configId);
  const { data: keyRow, error: keyError } = await admin
    .from("provider_keys")
    .insert({
      provider_config_id: configId,
      key_ciphertext: encrypted.key_ciphertext,
      key_iv: encrypted.key_iv,
      key_auth_tag: encrypted.key_auth_tag,
      key_fingerprint: encrypted.key_fingerprint,
      label: label,
      weight: weightNum,
      is_active: true,
    })
    .select("id, key_fingerprint")
    .single();

  if (keyError) {
    // Roll back the config so a failed seed leaves no orphan.
    await admin.from("provider_configs").delete().eq("id", configId);
    fail(`provider key insert failed: ${keyError.message}`);
  }

  console.log(`[ok] provider config ${configId} (${name}, ${adapterType})`);
  console.log(
    `[ok] provider key ${keyRow.id} fingerprint ${keyRow.key_fingerprint.slice(0, 12)}...`,
  );
  console.log("[ok] plaintext key never printed");
}

main().catch((error) => fail(error instanceof Error ? error.message : String(error)));
