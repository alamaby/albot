// Validate Vercel Production env var formats against src/env.ts rules.
// Usage (values are never printed):
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... PROVIDER_KEY_ENCRYPTION_KEY=... \
//   TELEGRAM_BOT_TOKEN=... TELEGRAM_WEBHOOK_SECRET=... JOB_PROCESSOR_SECRET=... \
//   node scripts/verify-env-format.mjs
//
// Or load from a local uncommitted file .env.prod.check (KEY=VALUE lines):
//   node --env-file=.env.prod.check scripts/verify-env-format.mjs

const results = [];
let failures = 0;

function check(name, fn) {
  const value = process.env[name];
  if (value === undefined || value === "") {
    results.push(`[FAIL] ${name}: missing/empty`);
    failures++;
    return;
  }
  try {
    fn(value);
    results.push(`[ok] ${name} (${value.length} chars)`);
  } catch (error) {
    results.push(`[FAIL] ${name}: ${error.message}`);
    failures++;
  }
}

check("SUPABASE_URL", (v) => {
  let url;
  try {
    url = new URL(v);
  } catch {
    throw new Error("not a valid URL");
  }
  if (url.protocol !== "https:") throw new Error("must be https");
});

check("SUPABASE_SERVICE_ROLE_KEY", (v) => {
  if (v.length < 1) throw new Error("empty");
  if (!/^eyJ/.test(v)) throw new Error("does not look like a JWT (should start with eyJ)");
});

check("PROVIDER_KEY_ENCRYPTION_KEY", (v) => {
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(v) || v.length % 4 === 1) {
    throw new Error("not valid standard base64 (contains invalid characters)");
  }
  const decoded = Buffer.from(v, "base64");
  if (decoded.toString("base64").replace(/=+$/, "") !== v.replace(/=+$/, "")) {
    throw new Error("base64 does not round-trip cleanly");
  }
  if (decoded.length !== 32) {
    throw new Error(`decodes to ${decoded.length} bytes, must be exactly 32 (hint: randomBytes(32).toString('base64'))`);
  }
  if (decoded.every((b) => b === 0)) throw new Error("all-zero key");
});

check("TELEGRAM_BOT_TOKEN", (v) => {
  if (!/^[0-9]+:[A-Za-z0-9_-]+$/.test(v)) {
    throw new Error("must match <numeric-id>:<alphanumeric_-_> (Telegram bot token format)");
  }
});

check("TELEGRAM_WEBHOOK_SECRET", (v) => {
  if (!/^[A-Za-z0-9_-]+$/.test(v)) {
    throw new Error("contains characters outside [A-Za-z0-9_-] (hint: use base64url, NOT base64 with +/-/=)");
  }
  if (v.length < 8) throw new Error("shorter than 8 characters");
});

check("JOB_PROCESSOR_SECRET", (v) => {
  if (v.length < 32) throw new Error(`${v.length} chars, must be at least 32`);
});

console.log(results.join("\n"));
console.log(failures === 0 ? "\nAll env formats valid." : `\n${failures} variable(s) failed — fix before redeploying.`);
process.exit(failures === 0 ? 0 : 1);
