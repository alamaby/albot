// Provider key upsert helper (development/production).
//
// Replaces the encrypted key for an existing provider_configs row.
// Looks up the config by (adapter_type, model, capability) — the natural
// identifier from the seed migration — then DELETEs all existing
// provider_keys rows for that config and INSERTs a freshly-encrypted one.
//
// Usage:
//   node scripts/upsert-provider-key.mjs <adapter_type> <model> \
//       [--capability <reasoning|image_generation>] \
//       [--key <plaintext>] [--env-key <ENV_VAR_NAME>] \
//       [--label <label>] [--weight <n>]
//
// Key precedence: --key <plaintext> > --env-key <NAME> > PROVIDER_KEY env.
//
// Idempotency: deletes any existing keys for the config before inserting
// (callers should not run this on a config that is in active use mid-flight).
// Prints config id, key id, and key fingerprint prefix; never prints the
// plaintext key.
//
// Reads SUPABASE_URL / SUPABASE_SECRET_KEY /
// PROVIDER_KEY_ENCRYPTION_KEY from environment (same as the seed script).

import { createClient } from "@supabase/supabase-js";
import { createCipheriv, createHash, randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const CAPABILITIES = ["reasoning", "image_generation"];

function fail(message) {
  console.error(`[error] ${message}`);
  process.exit(1);
}

function loadDotEnv() {
  // Load .env.local first (developer overrides), then .env (defaults) without
  // overwriting variables already set in the shell. Both files are optional.
  for (const filename of [".env.local", ".env"]) {
    const file = join(process.cwd(), filename);
    if (!existsSync(file)) continue;
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

function parseArg(name) {
  const idx = process.argv.indexOf(`--${name}`);
  if (idx === -1) return undefined;
  return process.argv[idx + 1];
}

async function main() {
  loadDotEnv();
  const [adapterType, model] = process.argv.slice(2);
  if (!adapterType || !model) {
    fail(
      "usage: node scripts/upsert-provider-key.mjs <adapter_type> <model> " +
        "[--capability <reasoning|image_generation>] " +
        "[--key <plaintext>] [--env-key <ENV_VAR_NAME>] [--label <label>] [--weight <n>]",
    );
  }

  const capability = parseArg("capability") ?? "image_generation";
  if (!CAPABILITIES.includes(capability)) {
    fail(`capability must be one of: ${CAPABILITIES.join(", ")}`);
  }

  const weightRaw = parseArg("weight");
  const weight = weightRaw ? Number(weightRaw) : 1;
  if (!Number.isInteger(weight) || weight <= 0) fail("weight must be a positive integer");

  const label = parseArg("label") ?? null;

  // Precedence: --key > --env-key <NAME> > PROVIDER_KEY env.
  let plaintextKey = parseArg("key");
  if (!plaintextKey) {
    const envKeyName = parseArg("env-key");
    if (envKeyName) plaintextKey = process.env[envKeyName];
  }
  if (!plaintextKey) plaintextKey = process.env.PROVIDER_KEY;
  if (!plaintextKey || plaintextKey.length === 0) {
    fail(
      "plaintext provider key required (--key <key>, --env-key <ENV_VAR_NAME>, or PROVIDER_KEY env)",
    );
  }

  const env = {
    SUPABASE_URL: resolveEnv(["SUPABASE_URL", "SUPABASE_URL_DEV", "SUPABASE_URL_PROD"]),
    SUPABASE_SECRET_KEY: resolveEnv([
      "SUPABASE_SECRET_KEY",
      "SUPABASE_SECRET_KEY_DEV",
      "SUPABASE_SECRET_KEY_PROD",
    ]),
    PROVIDER_KEY_ENCRYPTION_KEY: resolveEnv(["PROVIDER_KEY_ENCRYPTION_KEY"]),
  };
  if (!env.SUPABASE_URL || !env.SUPABASE_SECRET_KEY) {
    fail(
      "SUPABASE_URL and SUPABASE_SECRET_KEY env vars are required " +
        "(resolves SUPABASE_URL_* / SUPABASE_SECRET_KEY_* from .env.local)",
    );
  }
  if (!env.PROVIDER_KEY_ENCRYPTION_KEY) {
    fail("PROVIDER_KEY_ENCRYPTION_KEY env var is required");
  }

  const rootKey = parseEncryptionKey(env.PROVIDER_KEY_ENCRYPTION_KEY);
  const admin = createClient(env.SUPABASE_URL, env.SUPABASE_SECRET_KEY, {
    auth: { persistSession: false },
  });

  const { data: config, error: configError } = await admin
    .from("provider_configs")
    .select("id, adapter_type, model, capability")
    .eq("adapter_type", adapterType)
    .eq("model", model)
    .eq("capability", capability)
    .maybeSingle();
  if (configError) fail(`provider config lookup failed: ${configError.message}`);
  if (!config) {
    fail(
      `no provider_configs row found for adapter_type=${adapterType} model=${model} capability=${capability}`,
    );
  }
  const configId = config.id;
  console.log(`[info] resolved config ${configId}`);

  // Replace all existing keys for this config with a single new key.
  const { error: delError } = await admin
    .from("provider_keys")
    .delete()
    .eq("provider_config_id", configId);
  if (delError) fail(`provider key delete failed: ${delError.message}`);

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
      weight: weight,
      is_active: true,
    })
    .select("id, key_fingerprint")
    .single();
  if (keyError) fail(`provider key insert failed: ${keyError.message}`);

  console.log(
    `[ok] provider key ${keyRow.id} fingerprint ${keyRow.key_fingerprint.slice(0, 12)}...`,
  );
  console.log("[ok] plaintext key never printed");
}

main().catch((error) => fail(error instanceof Error ? error.message : String(error)));
