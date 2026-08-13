// Telegram webhook management script (development).
//
// Usage (run from repo root, secrets via environment or arguments):
//   node scripts/set-telegram-webhook.mjs get  <bot_token>
//   node scripts/set-telegram-webhook.mjs set  <bot_token> <webhook_url> <secret_token>
//   node scripts/set-telegram-webhook.mjs delete <bot_token>
//
// The secret_token must match TELEGRAM_WEBHOOK_SECRET for the target environment.
// Development webhook should point at the stable Vercel Preview alias; the
// production webhook must remain unset until Milestone 7.
//
// Never print the bot token to stdout.

const API_BASE = "https://api.telegram.org";
const ALLOWED_UPDATES = ["message", "callback_query"];

function fail(message) {
  console.error(`[error] ${message}`);
  process.exit(1);
}

async function callApi(token, method, payload) {
  const response = await fetch(`${API_BASE}/bot${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body = await response.json();
  if (!body.ok) {
    fail(`${method} failed: code ${body.error_code ?? "unknown"} (${body.description ?? ""})`);
  }
  return body.result;
}

async function getWebhookInfo(token) {
  const result = await callApi(token, "getWebhookInfo", {});
  // Redact nothing (this endpoint returns no secret), but never print the token.
  console.log(
    JSON.stringify(
      {
        url: result.url,
        has_custom_certificate: result.has_custom_certificate,
        pending_update_count: result.pending_update_count,
        allowed_updates: result.allowed_updates,
        last_error_message: result.last_error_message ?? null,
        ip_address: result.ip_address ?? null,
      },
      null,
      2,
    ),
  );
  if (result.url && result.url !== "") {
    console.log("[warn] a webhook is currently set for this bot");
  }
}

async function setWebhook(token, url, secretToken) {
  await callApi(token, "setWebhook", {
    url,
    secret_token: secretToken,
    allowed_updates: ALLOWED_UPDATES,
    max_connections: 40,
    drop_pending_updates: false,
  });
  console.log(`[ok] webhook set to ${url}`);
  console.log(`[ok] allowed_updates: ${ALLOWED_UPDATES.join(", ")}`);
}

async function deleteWebhook(token) {
  await callApi(token, "deleteWebhook", { drop_pending_updates: false });
  console.log("[ok] webhook deleted");
}

const [command, botToken, url, secretToken] = process.argv.slice(2);

if (!command || !botToken) {
  fail(
    "usage: node scripts/set-telegram-webhook.mjs <get|set|delete> <bot_token> [webhook_url] [secret_token]\n" +
      "   - webhook_url must start with https:// (for set)\n" +
      "   - set command is disabled in production (APP_ENV=production)",
  );
}

switch (command) {
  case "get":
    await getWebhookInfo(botToken);
    break;
  case "set":
    if (!url || !secretToken) {
      fail("set requires <webhook_url> and <secret_token>");
    }
    // HTTPS validation
    if (!url.startsWith("https://")) {
      fail("webhook URL must start with https://");
    }
    // APP_ENV guard: disallow setting webhook in production
    const appEnv = process.env.APP_ENV || "development";
    if (appEnv === "production") {
      fail(
        "refusing to set webhook in production environment (use Vercel dashboard or wait for Milestone 7)",
      );
    }
    await setWebhook(botToken, url, secretToken);
    break;
  case "delete":
    await deleteWebhook(botToken);
    break;
  default:
    fail(`unknown command: ${command}`);
}
