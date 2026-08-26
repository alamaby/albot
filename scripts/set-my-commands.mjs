// Telegram bot command menu registration (setMyCommands).
//
// Usage (run from repo root):
//   node scripts/set-my-commands.mjs get  <bot_token>
//   node scripts/set-my-commands.mjs set  <bot_token> [--allow-prod]
//
// Telegram command names only allow a-z 0-9 _ (no hyphens), so the menu lists
// the underscore variants; the bot parser accepts both spellings.
// The production bot requires the explicit --allow-prod flag (Milestone 7+).
//
// Never print the bot token to stdout.

const API_BASE = "https://api.telegram.org";

const COMMANDS = [
  { command: "start", description: "Mulai bot — daftar command" },
  { command: "help", description: "Bantuan dan daftar command" },
  {
    command: "generate_image",
    description: "Langsung buat gambar: /generate-image <prompt> (alias /generate_image)",
  },
  {
    command: "enhance_prompt",
    description:
      "Sempurnakan prompt (hasil teks): /enhance-prompt <prompt> (alias /enhance_prompt)",
  },
  { command: "cancel", description: "Batalkan sesi aktif" },
];

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

const argv = process.argv.slice(2);
const allowProd = argv.includes("--allow-prod");
const positional = argv.filter((arg) => arg !== "--allow-prod");
const [command, botToken] = positional;

if (!command || !botToken) {
  fail("usage: node scripts/set-my-commands.mjs <get|set> <bot_token> [--allow-prod]");
}

switch (command) {
  case "get": {
    const result = await callApi(botToken, "getMyCommands", {});
    console.log(JSON.stringify(result, null, 2));
    break;
  }
  case "set": {
    const appEnv = process.env.APP_ENV || "development";
    if (appEnv === "production" && !allowProd) {
      fail("refusing to set commands for the production bot without --allow-prod flag");
    }
    await callApi(botToken, "setMyCommands", { commands: COMMANDS });
    console.log(`[ok] ${COMMANDS.length} commands registered`);
    break;
  }
  default:
    fail(`unknown command: ${command}`);
}
