# Milestone 3 Bootstrap Runbook

This runbook documents the manual steps required to bootstrap Milestone 3 (Telegram Intake and Durable Jobs) in a development environment.

## Prerequisites

- Vercel CLI installed (`npm i -g vercel`)
- Access to a Telegram bot token (for development)
- Access to Supabase development project
- Local Supabase stack running (optional, for local development)

## Steps

### 1. Environment Variables

Set the following environment variables in your Vercel Preview (or development) environment:

- `APP_ENV=development`
- `TELEGRAM_BOT_TOKEN` (your development bot token)
- `TELEGRAM_WEBHOOK_SECRET` (a random string for webhook authentication)
- `JOB_PROCESSOR_SECRET` (a random string for job processor authentication)
- `SUPABASE_URL` (your Supabase development project URL)
- `SUPABASE_SERVICE_ROLE_KEY` (your Supabase service role key)
- `PROVIDER_KEY_ENCRYPTION_KEY` (a random encryption key for provider config)

### 2. Deploy to Vercel Preview

```bash
vercel --prod
```

This will deploy the application to a Preview URL.

### 3. Set Telegram Webhook

Use the provided script to set the webhook for your development bot:

```bash
node scripts/set-telegram-webhook.mjs set <TELEGRAM_BOT_TOKEN> <VERCEL_PREVIEW_URL>/api/telegram/webhook <TELEGRAM_WEBHOOK_SECRET>
```

Replace:

- `<TELEGRAM_BOT_TOKEN>` with your development bot token
- `<VERCEL_PREVIEW_URL>` with the URL from the Vercel deployment (e.g., `https://albot-git-main-alamaby.vercel.app`)
- `<TELEGRAM_WEBHOOK_SECRET>` with the value of `TELEGRAM_WEBHOOK_SECRET` from your environment

The script will validate that the URL starts with `https://` and that `APP_ENV` is not `production`.

### 4. Bootstrap Admin User

Manually insert an allowlisted admin user into the `bot_users` table:

```sql
INSERT INTO public.bot_users
(telegram_user_id, is_allowed, is_admin, username)
VALUES
(<YOUR_TELEGRAM_USER_ID>, true, true, '<YOUR_TELEGRAM_USERNAME>')
ON CONFLICT (telegram_user_id) DO UPDATE
SET is_allowed = EXCLUDED.is_allowed,
    is_admin = EXCLUDED.is_admin,
    username = EXCLUDED.username;
```

Replace:

- `<YOUR_TELEGRAM_USER_ID>` with your Telegram user ID (as a bigint)
- `<YOUR_TELEGRAM_USERNAME>` with your Telegram username (optional)

You can get your Telegram user ID by chatting with [@userinfobot](https://t.me/userinfobot).

### 5. Verify Installation

Send a test message to your bot:

```
/start
```

You should receive an "access denied" message if your user is not in the allowlist. After adding yourself to the allowlist, send a prompt and verify:

1. The bot responds with "Prompt diterima. Sedang dalam antrian..."
2. A row is inserted into `prompt_sessions` with `status='received'`
3. A row is inserted into `prompt_revisions` with `status='pending'`
4. A row is inserted into `jobs` with `status='queued'`
5. A row is inserted into `telegram_updates`

### 6. Check Webhook Info

To verify the webhook is set correctly:

```bash
node scripts/set-telegram-webhook.mjs get <TELEGRAM_BOT_TOKEN>
```

This will output the current webhook configuration.

### 7. Remove Webhook (if needed)

To delete the webhook:

```bash
node scripts/set-telegram-webhook.mjs delete <TELEGRAM_BOT_TOKEN>
```

## Troubleshooting

- **Webhook not receiving updates**: Verify the webhook URL and secret token. Check Vercel function logs for errors.
- **Bot not responding**: Ensure the bot is deployed and the webhook is set correctly. Check that the bot token is valid.
- **Database errors**: Verify the Supabase connection and that the migrations have been applied.
- **Rate limiting**: The default rate limit is 5 messages per 10 minutes. Wait for the window to reset if you hit the limit.

## Notes

- This runbook is for development only. Production setup requires additional steps and will be documented in Milestone 7.
- The webhook must remain unset in production until Milestone 7.
- All secrets should be managed via Vercel environment variables and not committed to the repository.
